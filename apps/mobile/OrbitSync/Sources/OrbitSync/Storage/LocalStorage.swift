import Foundation

struct WriterRecord: Equatable, Sendable {
  var device: String
  var seqs: [String: [String: Int]] = [:]

  func seq(chain: String, scope: String) -> Int { seqs[chain]?[scope] ?? 0 }

  mutating func raise(chain: String, scope: String, to seq: Int) {
    if seq > self.seq(chain: chain, scope: scope) { seqs[chain, default: [:]][scope] = seq }
  }

  var json: JSONValue {
    .object([
      "v": .number(1),
      "device": .string(device),
      "seqs": .object(seqs.mapValues { .object($0.mapValues { .number(Double($0)) }) }),
    ])
  }

  init(device: String, seqs: [String: [String: Int]] = [:]) {
    self.device = device
    self.seqs = seqs
  }

  init?(json: JSONValue) {
    guard let device = json["device"]?.string, !device.isEmpty else { return nil }
    self.device = device
    for (chain, scopes) in json["seqs"]?.object ?? [:] {
      seqs[chain] = scopes.object?.compactMapValues { $0.number.map { Int($0) } }
    }
  }

  init?(data: Data?) {
    guard let data, let json = try? JSONValue.parse(data) else { return nil }
    self.init(json: json)
  }

  func merged(with other: WriterRecord?) -> WriterRecord {
    guard let other, other.device == device else { return self }
    var out = self
    for (chain, scopes) in other.seqs {
      for (scope, seq) in scopes { out.raise(chain: chain, scope: scope, to: seq) }
    }
    return out
  }
}

struct RetirementRecord: Equatable, Sendable {
  var device: String
  var retirer: String
  var bookmark: Data?
  var created: Double
  var seqs: [String: Int] = [:]
  var batches: [Batch] = []

  struct Batch: Equatable, Sendable {
    var scope: String
    var payload: String
  }

  init(device: String, bookmark: Data?, created: Double) {
    self.device = device
    retirer = SyncKeys.newFileId()
    self.bookmark = bookmark
    self.created = created
  }

  var json: JSONValue {
    var object: [String: JSONValue] = [
      "v": .number(1),
      "device": .string(device),
      "retirer": .string(retirer),
      "created": .number(created),
      "seqs": .object(seqs.mapValues { .number(Double($0)) }),
      "batches": .array(batches.map { .object(["scope": .string($0.scope), "payload": .string($0.payload)]) }),
    ]
    if let bookmark { object["bookmark"] = .string(bookmark.base64EncodedString()) }
    return .object(object)
  }

  init?(json: JSONValue) {
    guard let device = json["device"]?.string, let retirer = json["retirer"]?.string else { return nil }
    self.device = device
    self.retirer = retirer
    bookmark = json["bookmark"]?.string.flatMap { Data(base64Encoded: $0) }
    created = json["created"]?.number ?? 0
    seqs = json["seqs"]?.object?.compactMapValues { $0.number.map { Int($0) } } ?? [:]
    batches = (json["batches"]?.array ?? []).compactMap { item in
      guard let scope = item["scope"]?.string, let payload = item["payload"]?.string else { return nil }
      return Batch(scope: scope, payload: payload)
    }
  }
}

struct LocalStorage: Sendable {
  let directory: URL

  static var defaultDirectory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
    return base.appendingPathComponent("OrbitSync", isDirectory: true)
  }

  enum Item: String, CaseIterable {
    case writer = "writer.json"
    case bookmark = "folder.bookmark"
    case state = "state.nns"
    case journal = "journal.nns"
    case transition = "transition.json"
  }

  func url(_ item: Item) -> URL { directory.appendingPathComponent(item.rawValue) }

  func read(_ item: Item) -> Data? { try? Data(contentsOf: url(item)) }

  func exists(_ item: Item) -> Bool { FileManager.default.fileExists(atPath: url(item).path) }

  func write(_ data: Data, to item: Item) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    #if os(iOS)
    try data.write(to: url(item), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try data.write(to: url(item), options: [.atomic])
    #endif
  }

  func remove(_ item: Item) {
    try? FileManager.default.removeItem(at: url(item))
  }

  func loadWriter() -> WriterRecord? {
    guard let data = read(.writer), let json = try? JSONValue.parse(data) else { return nil }
    return WriterRecord(json: json)
  }

  func saveWriter(_ writer: WriterRecord) throws {
    try write(writer.json.data, to: .writer)
  }

  func loadTransition() -> Transition? {
    read(.transition).flatMap { try? JSONValue.parse($0) }.flatMap(Transition.init(json:))
  }

  func saveTransition(_ transition: Transition) throws {
    try write(transition.json.data, to: .transition)
  }

  func removeTransition() { remove(.transition) }

  var retiringRoot: URL { directory.appendingPathComponent("retiring", isDirectory: true) }

  var retirements: [RetirementRecord] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: retiringRoot.path)) ?? []
    return names.filter { $0.hasSuffix(".json") }.sorted().compactMap { name in
      (try? Data(contentsOf: retiringRoot.appendingPathComponent(name))).flatMap { try? JSONValue.parse($0) }.flatMap(RetirementRecord.init(json:))
    }
  }

  func saveRetirement(_ record: RetirementRecord) throws {
    try FileManager.default.createDirectory(at: retiringRoot, withIntermediateDirectories: true)
    try record.json.data.write(to: retiringRoot.appendingPathComponent("\(record.device).json"), options: [.atomic])
  }

  func removeRetirement(_ device: String) {
    try? FileManager.default.removeItem(at: retiringRoot.appendingPathComponent("\(device).json"))
  }

  func quarantine(_ item: Item) {
    let folder = directory.appendingPathComponent("quarantine", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? FileManager.default.moveItem(at: url(item), to: folder.appendingPathComponent("\(UUID().uuidString)-\(item.rawValue)"))
  }

  func excludeFromBackup() {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var url = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }

  func readSealed(_ item: Item, keys: SyncKeys) -> JSONValue? {
    guard let sealed = read(item), let plain = try? keys.open(sealed, scopeTag: "local", fileId: item.rawValue) else { return nil }
    return try? JSONValue.parse(plain)
  }

  func opensSealed(_ item: Item, keys: SyncKeys) -> Bool {
    guard let sealed = read(item) else { return true }
    return (try? keys.open(sealed, scopeTag: "local", fileId: item.rawValue)) != nil
  }

  func writeSealed(_ value: JSONValue, to item: Item, keys: SyncKeys) throws {
    try write(try keys.seal(value.data, scopeTag: "local", fileId: item.rawValue), to: item)
  }
}
