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

  func newWriter() -> WriterRecord {
    let writer = WriterRecord(device: SyncKeys.newFileId())
    try? saveWriter(writer)
    return writer
  }

  var retiringRoot: URL { directory.appendingPathComponent("retiring", isDirectory: true) }

  func retiring(_ device: String) -> LocalStorage {
    LocalStorage(directory: retiringRoot.appendingPathComponent(device, isDirectory: true))
  }

  var retirements: [LocalStorage] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: retiringRoot.path)) ?? []
    return names.filter { !$0.hasPrefix(".") }.sorted().map { LocalStorage(directory: retiringRoot.appendingPathComponent($0, isDirectory: true)) }
  }

  func move(_ items: [Item], to other: LocalStorage) throws {
    try FileManager.default.createDirectory(at: other.directory, withIntermediateDirectories: true)
    for item in items where exists(item) {
      other.remove(item)
      try FileManager.default.moveItem(at: url(item), to: other.url(item))
    }
  }

  func removeAll() {
    try? FileManager.default.removeItem(at: directory)
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
