import Foundation

enum FolderBookmark {
  static func create(for url: URL) throws -> Data {
    #if os(macOS)
    if let data = try? url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) { return data }
    #endif
    return try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
  }

  static func resolve(_ data: Data, stale: inout Bool) throws -> URL {
    #if os(macOS)
    if let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale) { return url }
    #endif
    return try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
  }
}

enum SessionFailure: Error, Equatable {
  case noFolder
  case locked
  case folderUnavailable
  case chainMissing
}

final class SyncSession {
  static let maxOpenTabs = 30

  struct JournalEntry {
    var scope: String
    var batch: LogFile
    var payload: String
  }

  let storage: LocalStorage
  let now: () -> Date
  var writeFile: (FolderVault, String, Data) throws -> String = { vault, scope, payload in try vault.write(scope: scope, payload: payload) }

  private(set) var deviceId: String
  var deviceName: String
  var deviceKind: String
  var openTabs: [SyncedTab]?
  private(set) var bookmark: Data?
  private(set) var keys: SyncKeys?
  private(set) var app = ScopeReplica()
  private(set) var spaces: [String: ScopeReplica] = [:]
  private(set) var clock: HybridClock
  private(set) var journal: [JournalEntry] = []
  private(set) var lastSync: Date?
  private(set) var writer: WriterRecord

  init(storage: LocalStorage, deviceId: String, deviceName: String, deviceKind: String, bookmark: Data?, now: @escaping () -> Date = Date.init) {
    self.storage = storage
    self.deviceId = deviceId
    self.deviceName = deviceName
    self.deviceKind = deviceKind
    self.bookmark = bookmark
    self.now = now
    clock = HybridClock(device: deviceId)
    writer = Self.writer(for: deviceId, in: storage)
  }

  static func writer(for deviceId: String, in storage: LocalStorage) -> WriterRecord {
    if let saved = storage.loadWriter(), saved.device == deviceId { return saved }
    return WriterRecord(device: deviceId)
  }

  static func retire(_ storage: LocalStorage, entropy: Data, now: @escaping () -> Date = Date.init) throws {
    guard let writer = storage.loadWriter(), let bookmark = storage.read(.bookmark) else { return }
    let session = SyncSession(storage: storage, deviceId: writer.device, deviceName: "", deviceKind: "", bookmark: bookmark, now: now)
    session.unlock(entropy: entropy)
    try session.retire()
  }

  private var nowMs: Double { (now().timeIntervalSince1970 * 1000).rounded(.down) }

  func unlock(entropy: Data) {
    keys = SyncKeys(entropy: entropy)
    loadState()
  }

  func connect(bookmark: Data, deviceId: String) throws {
    if deviceId != self.deviceId { adoptIdentity(deviceId) }
    try storage.write(bookmark, to: .bookmark)
    self.bookmark = bookmark
  }

  func adoptIdentity(_ deviceId: String) {
    keys = nil
    self.deviceId = deviceId
    writer = Self.writer(for: deviceId, in: storage)
    forgetData()
  }

  func chainMatches(entropy: Data) throws -> Bool {
    let candidate = SyncKeys(entropy: entropy)
    return try withFolder(keys: candidate) { $0.chainExists() }
  }

  func adopt(entropy: Data) throws -> Bool {
    guard try chainMatches(entropy: entropy) else { return false }
    unlock(entropy: entropy)
    return true
  }

  func lock() {
    keys = nil
  }

  func forgetData() {
    app = ScopeReplica()
    spaces = [:]
    journal = []
    lastSync = nil
    clock = HybridClock(device: deviceId)
    storage.remove(.state)
    storage.remove(.journal)
  }

  func disconnect() {
    keys = nil
    bookmark = nil
    openTabs = nil
    forgetData()
    storage.remove(.bookmark)
  }

  func detachForRetirement() throws {
    if keys != nil { try? saveState() }
    try storage.move([.state, .journal, .bookmark, .writer], to: storage.retiring(deviceId))
    keys = nil
    bookmark = nil
    openTabs = nil
    app = ScopeReplica()
    spaces = [:]
    journal = []
    lastSync = nil
  }

  var views: SyncedViews {
    let ids = Set(SpaceKeys.spaceIds(in: app))
    return ViewBuilder.build(app: app, spaces: spaces.filter { ids.contains($0.key) }, me: deviceId)
  }

  func withFolder<T>(keys: SyncKeys? = nil, _ body: (FolderVault) throws -> T) throws -> T {
    guard let keys = keys ?? self.keys else { throw SessionFailure.locked }
    guard let bookmark else { throw SessionFailure.noFolder }
    var stale = false
    guard let url = try? FolderBookmark.resolve(bookmark, stale: &stale) else { throw SessionFailure.folderUnavailable }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    if stale, let fresh = try? FolderBookmark.create(for: url) {
      self.bookmark = fresh
      try? storage.write(fresh, to: .bookmark)
    }
    let vault = FolderVault(folder: url, keys: keys)
    guard vault.folderExists else { throw SessionFailure.folderUnavailable }
    return try body(vault)
  }

  func cycle() throws -> SyncedViews {
    try withFolder { vault in
      guard vault.chainExists() else { throw SessionFailure.chainMissing }
      try flushJournal(vault)
      pull(vault)
      try publish(vault)
      lastSync = now()
      try saveState()
      return views
    }
  }

  func retire() throws {
    try withFolder { vault in
      guard vault.chainExists() else { return }
      try flushJournal(vault)
      pull(vault)
      var batches: [String: [SyncOp]] = [:]
      put(.null, key: SpaceKeys.device + deviceId, scope: SpaceKeys.appScope, into: &batches)
      for id in spaces.keys.sorted(by: jsLess) {
        put(.null, key: SpaceKeys.tabs + deviceId, scope: SpaceKeys.scope(ofSpace: id), into: &batches)
      }
      try commit(batches, vault)
    }
  }

  private func pull(_ vault: FolderVault) {
    let started = nowMs
    app.pull(vault.read(scope: SpaceKeys.appScope, skipping: Set(app.files.keys)), now: started, clock: &clock, keep: SpaceKeys.keepsApp)
    let ids = SpaceKeys.spaceIds(in: app)
    for id in ids {
      var replica = spaces[id] ?? ScopeReplica()
      replica.pull(vault.read(scope: SpaceKeys.scope(ofSpace: id), skipping: Set(replica.files.keys)), now: nowMs, clock: &clock, keep: SpaceKeys.keepsSpace)
      spaces[id] = replica
    }
    for id in spaces.keys where !ids.contains(id) { spaces[id] = nil }
  }

  private func publish(_ vault: FolderVault) throws {
    var batches: [String: [SyncOp]] = [:]
    put(.object(["n": .string(deviceName)]), key: SpaceKeys.device + deviceId, scope: SpaceKeys.appScope, into: &batches)
    if let openTabs, let target = SpaceKeys.defaultSpaceId(in: app) {
      let key = SpaceKeys.tabs + deviceId
      put(tabsValue(openTabs), key: key, scope: SpaceKeys.scope(ofSpace: target), into: &batches)
      for id in spaces.keys.sorted(by: jsLess) where id != target {
        put(.null, key: key, scope: SpaceKeys.scope(ofSpace: id), into: &batches)
      }
    }
    try commit(batches, vault)
  }

  func tabsValue(_ tabs: [SyncedTab]) -> JSONValue {
    let shared = tabs.filter { ["http", "https"].contains($0.url.scheme?.lowercased() ?? "") }.prefix(Self.maxOpenTabs)
    return .object([
      "n": .string(deviceName),
      "k": .string(deviceKind),
      "tabs": .array(shared.map { .object(["u": .string($0.url.absoluteString), "t": .string($0.title)]) }),
    ])
  }

  private func replica(_ scope: String) -> ScopeReplica {
    scope == SpaceKeys.appScope ? app : spaces[String(scope.dropFirst(2))] ?? ScopeReplica()
  }

  private func update(_ scope: String, _ body: (inout ScopeReplica) -> Void) {
    if scope == SpaceKeys.appScope {
      body(&app)
    } else {
      let id = String(scope.dropFirst(2))
      var replica = spaces[id] ?? ScopeReplica()
      body(&replica)
      spaces[id] = replica
    }
  }

  private func put(_ value: JSONValue, key: String, scope: String, into batches: inout [String: [SyncOp]]) {
    let current = replica(scope).records[key]
    if value.isNull {
      guard let current, !current.v.isNull else { return }
    } else if current?.v == value {
      return
    }
    let h = clock.tick(now: Int64(nowMs))
    if let current, jsAtLeast(current.h, h) { return }
    batches[scope, default: []].append(SyncOp(k: key, h: h, v: value))
  }

  private func nextSeq(_ scope: String) -> Int {
    let replica = replica(scope)
    let journalled = journal.filter { $0.scope == scope && $0.batch.device == deviceId }.map(\.batch.seq).max() ?? 0
    let durable = keys.map { writer.seq(chain: $0.chainTag, scope: scope) } ?? 0
    return max(replica.seq, replica.highestSeq(of: deviceId), journalled, durable) + 1
  }

  private func recordSeqs(_ entries: [JournalEntry]) throws {
    guard let keys else { throw SessionFailure.locked }
    var raised = writer
    for entry in entries where entry.batch.device == deviceId {
      raised.raise(chain: keys.chainTag, scope: entry.scope, to: entry.batch.seq)
    }
    guard raised != writer else { return }
    try storage.saveWriter(raised)
    writer = raised
  }

  private func commit(_ batches: [String: [SyncOp]], _ vault: FolderVault) throws {
    guard !batches.isEmpty else { return }
    let at = nowMs
    var entries: [JournalEntry] = []
    for scope in batches.keys.sorted(by: jsLess) {
      let batch = LogFile(device: deviceId, seq: nextSeq(scope), at: at, ops: batches[scope]!)
      entries.append(JournalEntry(scope: scope, batch: batch, payload: batch.json.serialized))
    }
    try persistJournal(journal + entries)
    journal += entries
    for entry in entries {
      update(entry.scope) { $0.restore(entry.batch, clock: &clock) }
    }
    try recordSeqs(entries)
    try flushJournal(vault)
  }

  private func flushJournal(_ vault: FolderVault) throws {
    guard !journal.isEmpty else { return }
    var failure: Error?
    var written: [Int] = []
    for (index, entry) in journal.enumerated() {
      do {
        let id = try writeFile(vault, entry.scope, Data(entry.payload.utf8))
        update(entry.scope) { $0.written(entry.batch, id: id, now: nowMs) }
        written.append(index)
      } catch {
        failure = error
        break
      }
    }
    if !written.isEmpty {
      try saveState()
      journal = journal.enumerated().filter { !written.contains($0.offset) }.map(\.element)
      try persistJournal(journal)
    }
    if let failure { throw failure }
  }

  private func persistJournal(_ entries: [JournalEntry]) throws {
    guard let keys else { throw SessionFailure.locked }
    if entries.isEmpty {
      storage.remove(.journal)
      return
    }
    let value = JSONValue.object(["v": .number(1), "journal": .array(entries.map { .object(["scope": .string($0.scope), "payload": .string($0.payload)]) })])
    try storage.writeSealed(value, to: .journal, keys: keys)
  }

  func saveState() throws {
    guard let keys else { throw SessionFailure.locked }
    var scopes: [String: JSONValue] = [SpaceKeys.appScope: app.json]
    for (id, replica) in spaces { scopes[SpaceKeys.scope(ofSpace: id)] = replica.json }
    var object: [String: JSONValue] = [
      "v": .number(1),
      "device": .string(deviceId),
      "keeps": .string(SpaceKeys.cacheSignature),
      "clock": .string(clock.last),
      "scopes": .object(scopes),
    ]
    if let lastSync { object["lastSync"] = .number(lastSync.timeIntervalSince1970 * 1000) }
    try storage.writeSealed(.object(object), to: .state, keys: keys)
  }

  private func loadState() {
    guard let keys else { return }
    for item in [LocalStorage.Item.state, .journal] where !storage.opensSealed(item, keys: keys) {
      storage.remove(item)
    }
    app = ScopeReplica()
    spaces = [:]
    journal = []
    lastSync = nil
    clock = HybridClock(device: deviceId)
    if let state = storage.readSealed(.state, keys: keys), state["device"]?.string == deviceId, state["keeps"]?.string == SpaceKeys.cacheSignature {
      clock = HybridClock(device: deviceId, last: state["clock"]?.string)
      for (scope, value) in state["scopes"]?.object ?? [:] {
        let replica = ScopeReplica(json: value)
        if scope == SpaceKeys.appScope {
          app = replica
        } else if scope.hasPrefix("p:") {
          spaces[String(scope.dropFirst(2))] = replica
        }
      }
      lastSync = state["lastSync"]?.number.map { Date(timeIntervalSince1970: $0 / 1000) }
    }
    if let saved = storage.readSealed(.journal, keys: keys) {
      for item in saved["journal"]?.array ?? [] {
        guard let scope = item["scope"]?.string, let payload = item["payload"]?.string,
              let parsed = try? JSONValue.parse(Data(payload.utf8)), let batch = LogFile(json: parsed) else { continue }
        journal.append(JournalEntry(scope: scope, batch: batch, payload: payload))
      }
      journal.sort { $0.scope == $1.scope ? $0.batch.seq < $1.batch.seq : jsLess($0.scope, $1.scope) }
      for entry in journal where entry.batch.device == deviceId {
        update(entry.scope) { $0.restore(entry.batch, clock: &clock) }
      }
      try? recordSeqs(journal)
    }
  }
}
