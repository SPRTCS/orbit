import Foundation

final class WriteGate: @unchecked Sendable {
  private let lock = NSLock()
  private var writer: String?

  func open(for device: String) { lock.withLock { writer = device } }

  func close() { lock.withLock { writer = nil } }

  func allows(_ device: String) -> Bool { lock.withLock { writer == device } }
}

struct Transition: Equatable, Sendable {
  enum Kind: String, Sendable {
    case rotate
    case disconnect
  }

  var kind: Kind
  var from: [String]
  var to: String

  init(kind: Kind, from: [String], to: String = SyncKeys.newFileId()) {
    self.kind = kind
    self.from = from
    self.to = to
  }

  var json: JSONValue {
    .object(["v": .number(1), "kind": .string(kind.rawValue), "from": .array(from.map(JSONValue.string)), "to": .string(to)])
  }

  init?(json: JSONValue) {
    guard let kind = json["kind"]?.string.flatMap(Kind.init(rawValue:)), let to = json["to"]?.string else { return nil }
    self.init(kind: kind, from: (json["from"]?.array ?? []).compactMap(\.string), to: to)
  }

  enum Outcome: Equatable {
    case done(WriterRecord)
    case stuck(String)
  }

  static let keychainMessage = "Couldn’t save the sync key in the Keychain."
  static let storageMessage = "Couldn’t save this device’s sync state."

  func finish(storage: LocalStorage, keyStore: any SyncKeyStore, now: Date) -> Outcome {
    let createdAt = (now.timeIntervalSince1970 * 1000).rounded(.down)
    let fresh = WriterRecord(device: to)
    let retiring = Set(storage.retirements.map(\.device))
    func retireSources() -> Bool {
      let bookmark = storage.read(.bookmark)
      for device in from where !retiring.contains(device) {
        let chain = keyStore.load(account: device).flatMap { $0.count == 32 ? SyncKeys(entropy: $0).chainTag : nil }
        guard (try? storage.saveRetirement(RetirementRecord(device: device, bookmark: bookmark, chain: chain, created: createdAt))) != nil else { return false }
      }
      return true
    }
    func commit() -> Bool {
      if let saved = storage.loadWriter(), saved.device == to, WriterRecord(data: keyStore.load(account: Identity.account))?.device == to { return true }
      return (try? Identity.saver(storage: storage, keyStore: keyStore)(fresh)) != nil
    }
    switch kind {
    case .rotate:
      if let carried = from.lazy.compactMap({ keyStore.load(account: $0) }).first(where: { $0.count == 32 }), keyStore.load(account: to) != carried {
        guard keyStore.save(carried, account: to), keyStore.load(account: to) == carried else { return .stuck(Self.keychainMessage) }
      }
      guard commit() else { return .stuck(Self.storageMessage) }
      guard retireSources() else { return .stuck(Self.storageMessage) }
      storage.remove(.state)
      storage.remove(.journal)
    case .disconnect:
      guard retireSources() else { return .stuck(Self.storageMessage) }
      storage.remove(.bookmark)
      storage.remove(.state)
      storage.remove(.journal)
      guard commit() else { return .stuck(Self.storageMessage) }
    }
    storage.removeTransition()
    return .done(fresh)
  }
}

enum Identity {
  static let account = "identity"

  static func saver(storage: LocalStorage, keyStore: any SyncKeyStore) -> (WriterRecord) throws -> Void {
    { record in
      guard keyStore.save(record.json.data, account: account) else { throw CocoaError(.fileWriteUnknown) }
      try storage.saveWriter(record)
    }
  }

  enum Resolution {
    case trusted(WriterRecord)
    case rotate(Transition)
  }

  static func resolve(storage: LocalStorage, keyStore: any SyncKeyStore) -> Resolution {
    let saved = storage.loadWriter()
    let anchor = WriterRecord(data: keyStore.load(account: account))
    let retiring = Set(storage.retirements.map(\.device))
    if let saved, let anchor, saved.device == anchor.device, !retiring.contains(saved.device) {
      let merged = saved.merged(with: anchor)
      if merged != saved || merged != anchor { try? saver(storage: storage, keyStore: keyStore)(merged) }
      return .trusted(merged)
    }
    var displaced: [String] = []
    if let saved { displaced.append(saved.device) }
    if let anchor, anchor.device != saved?.device { displaced.append(anchor.device) }
    if displaced.isEmpty {
      let fresh = WriterRecord(device: SyncKeys.newFileId())
      try? saver(storage: storage, keyStore: keyStore)(fresh)
      return .trusted(fresh)
    }
    return .rotate(Transition(kind: .rotate, from: displaced))
  }
}
