import Foundation

enum Retirement {
  static let giveUpAfter: Double = ScopeReplica.damagedGiveUp

  static func process(_ record: inout RetirementRecord, storage: LocalStorage, entropy: Data, bookmark: Data, ownFolder: Bool, now: Date) throws -> Bool {
    let keys = SyncKeys(entropy: entropy)
    if let chain = record.chain, chain != keys.chainTag { return false }
    var stale = false
    guard let url = try? FolderBookmark.resolve(bookmark, stale: &stale) else { throw SessionFailure.folderUnavailable }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let vault = FolderVault(folder: url, keys: keys)
    guard vault.folderExists else { throw SessionFailure.folderUnavailable }
    guard vault.chainExists() else { return ownFolder }
    try send(&record, storage: storage, vault: vault)

    let nowMs = (now.timeIntervalSince1970 * 1000).rounded(.down)
    let deviceKey = SpaceKeys.device + record.device
    let tabsKey = SpaceKeys.tabs + record.device
    var clock = HybridClock(device: record.retirer)
    var app = ScopeReplica()
    app.pull(vault.read(scope: SpaceKeys.appScope, skipping: []), now: nowMs, clock: &clock) { $0.hasPrefix(SpaceKeys.profile) || $0 == deviceKey }
    var complete = app.pending == 0 && app.damaged.isEmpty
    var live: [(scope: String, key: String)] = []
    if app.value(deviceKey) != nil || record.seqs[SpaceKeys.appScope] == nil { live.append((SpaceKeys.appScope, deviceKey)) }
    for id in SpaceKeys.spaceIds(in: app) {
      let scope = SpaceKeys.scope(ofSpace: id)
      var replica = ScopeReplica()
      replica.pull(vault.read(scope: scope, skipping: []), now: nowMs, clock: &clock) { $0 == tabsKey }
      complete = complete && replica.pending == 0 && replica.damaged.isEmpty
      if replica.value(tabsKey) != nil || record.seqs[scope] == nil { live.append((scope, tabsKey)) }
    }

    var ops: [String: [SyncOp]] = [:]
    for (scope, key) in live { ops[scope, default: []].append(SyncOp(k: key, h: clock.tick(now: Int64(nowMs)), v: .null)) }
    for scope in ops.keys.sorted(by: jsLess) {
      let seq = (record.seqs[scope] ?? 0) + 1
      record.seqs[scope] = seq
      let batch = LogFile(device: record.retirer, seq: seq, at: nowMs, ops: ops[scope]!)
      record.batches.append(RetirementRecord.Batch(scope: scope, payload: batch.json.serialized))
    }
    if !ops.isEmpty {
      try storage.saveRetirement(record)
      try send(&record, storage: storage, vault: vault)
    }
    return complete || nowMs - record.created > giveUpAfter
  }

  private static func send(_ record: inout RetirementRecord, storage: LocalStorage, vault: FolderVault) throws {
    while let batch = record.batches.first {
      _ = try vault.write(scope: batch.scope, payload: Data(batch.payload.utf8))
      record.batches.removeFirst()
      try storage.saveRetirement(record)
    }
  }
}
