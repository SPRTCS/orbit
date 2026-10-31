#if os(macOS)
import ArdiaSyncCore
import Foundation
import XCTest
@testable import OrbitSync

@MainActor
final class ClientTests: XCTestCase {
  let entropy = InteropTests.entropy
  var folder: URL!
  var storage: URL!
  var mac: SyncVault!
  let keyStore = MemoryKeyStore()

  override func setUp() async throws {
    folder = try Paths.scratch("client-folder")
    storage = try Paths.scratch("client-storage")
    mac = SyncVault(folder: folder, keys: ArdiaSyncCore.SyncKeys(entropy: entropy))
    try mac.createChain()
    let profile: [String: Any] = ["v": 1, "kind": "log", "device": "macdevice", "seq": 1, "at": 1_790_000_000_000, "ops": [
      ["k": "prof:personal", "h": "0mubbs7i8.0000.macdevice", "v": ["n": "Personal", "c": "plum", "i": NSNull(), "d": true]],
      ["k": "dev:macdevice", "h": "0mubbs7i8.0001.macdevice", "v": ["n": "Arman’s MacBook Pro"]],
      ["k": "tabs:macdevice", "h": "0mubbs7i8.0002.macdevice", "v": ["n": "Arman’s MacBook Pro", "tabs": [["u": "https://mac.example/", "t": "Mac"]]]],
    ]]
    try mac.write(scope: "app", payload: JSONSerialization.data(withJSONObject: profile))
    try mac.write(scope: "p:personal", payload: JSONSerialization.data(withJSONObject: ["v": 1, "kind": "log", "device": "macdevice", "seq": 1, "at": 1_790_000_000_000, "ops": profile["ops"]!]))
  }

  override func tearDown() async throws {
    setWritable(true)
    try? FileManager.default.removeItem(at: folder)
    try? FileManager.default.removeItem(at: storage)
  }

  var phrase: String { ArdiaSyncCore.RecoveryPhrase.words(for: entropy).joined(separator: " ") }

  func client() -> OrbitSyncClient {
    OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Arman’s iPhone", deviceKind: "iphone")
  }

  func connected() async throws -> OrbitSyncClient {
    let client = client()
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    try await client.enterRecoveryPhrase(phrase)
    XCTAssertEqual(client.devices.map(\.name), ["Arman’s MacBook Pro"])
    return client
  }

  func hold(_ runner: SessionRunner) -> DispatchSemaphore {
    let gate = DispatchSemaphore(value: 0)
    let started = DispatchSemaphore(value: 0)
    Task.detached { _ = try? await runner.run { _ in started.signal(); gate.wait() } }
    started.wait()
    return gate
  }

  func settle() async {
    for _ in 0..<50 { await Task.yield() }
  }

  func setWritable(_ writable: Bool) {
    let chain = mac.chainURL
    for name in (try? FileManager.default.contentsOfDirectory(atPath: chain.path)) ?? [] {
      try? FileManager.default.setAttributes([.posixPermissions: writable ? 0o755 : 0o555], ofItemAtPath: chain.appendingPathComponent(name).path)
    }
  }

  func latest(_ scope: String, _ key: String) throws -> Any? {
    var best: (h: String, v: Any)?
    for file in mac.read(scope: scope, skipping: []).files {
      let json = try JSONSerialization.jsonObject(with: file.payload) as? [String: Any]
      for op in json?["ops"] as? [[String: Any]] ?? [] where op["k"] as? String == key {
        let h = op["h"] as! String
        if best == nil || h > best!.h { best = (h, op["v"] ?? NSNull()) }
      }
    }
    return best?.v
  }

  func testACycleThatFinishesAfterDisconnectDoesntBringTheDataBack() async throws {
    let client = try await connected()
    let gate = hold(client.runner)
    let cycle = Task { await client.syncNow() }
    await settle()
    XCTAssertEqual(client.state, .syncing)
    client.disconnect()
    gate.signal()
    await cycle.value
    await client.waitForPendingWork()
    XCTAssertEqual(client.state, .notSetUp)
    XCTAssertTrue(client.spaces.isEmpty)
    XCTAssertTrue(client.devices.isEmpty)
  }

  func testAPhraseEnteredWhileDisconnectingSavesNoKey() async throws {
    let client = client()
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    XCTAssertEqual(client.state, .needsPhrase)
    let gate = hold(client.runner)
    let entering = Task { try await client.enterRecoveryPhrase(phrase) }
    await settle()
    client.disconnect()
    gate.signal()
    do {
      try await entering.value
      XCTFail("the phrase was accepted after disconnecting")
    } catch {
      XCTAssertEqual(error as? OrbitSyncError, .notConnected)
    }
    await client.waitForPendingWork()
    XCTAssertEqual(Array(keyStore.items.keys), [OrbitSyncClient.identityAccount], "no sync key was saved")
    XCTAssertEqual(client.state, .notSetUp)
  }

  func testAFailedRetirementKeepsItsKeyAndJournalAndIsRetriedAtLaunch() async throws {
    let client = try await connected()
    await client.publish(openTabs: [SyncedTab(url: URL(string: "https://phone.example/")!, title: "Phone")])
    let oldId = client.deviceId
    XCTAssertNotNil(try latest("app", "dev:\(oldId)") as? [String: Any])
    setWritable(false)
    client.disconnect()
    await client.waitForPendingWork()
    XCTAssertEqual(client.state, .notSetUp)
    XCTAssertNotNil(keyStore.items[oldId], "the key stays until the tombstones are written")
    XCTAssertTrue(client.pendingRetirement)
    XCTAssertNotNil(try latest("app", "dev:\(oldId)") as? [String: Any])
    setWritable(true)

    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertEqual(relaunched.state, .notSetUp)
    XCTAssertNotEqual(relaunched.deviceId, oldId)
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull, "the retirement went out at the next launch")
    XCTAssertTrue(try latest("p:personal", "tabs:\(oldId)") is NSNull)
    XCTAssertNil(keyStore.items[oldId])
    XCTAssertFalse(relaunched.pendingRetirement)
    XCTAssertFalse(FileManager.default.fileExists(atPath: storage.appendingPathComponent("retiring").appendingPathComponent(oldId).path))
  }

  func logs(_ scope: String, from device: String) throws -> [(url: URL, seq: Int, json: [String: Any])] {
    let directory = mac.chainURL.appendingPathComponent(ArdiaSyncCore.SyncKeys(entropy: entropy).scopeTag(scope))
    return try mac.read(scope: scope, skipping: []).files.compactMap { file in
      guard let json = try JSONSerialization.jsonObject(with: file.payload) as? [String: Any], json["device"] as? String == device, let seq = json["seq"] as? Int else { return nil }
      return (directory.appendingPathComponent("\(file.id).nns"), seq, json)
    }
  }

  func sentTitles(_ scope: String, from device: String) throws -> [String] {
    try logs(scope, from: device).flatMap { log in
      (log.json["ops"] as? [[String: Any]] ?? []).flatMap { (($0["v"] as? [String: Any])?["tabs"] as? [[String: String]] ?? []).compactMap { $0["t"] } }
    }
  }

  func hide(_ url: URL) throws -> () throws -> Void {
    let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
    let aside = storage.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    try FileManager.default.moveItem(at: url, to: aside)
    try Data().write(to: placeholder)
    return {
      try FileManager.default.removeItem(at: placeholder)
      try FileManager.default.moveItem(at: aside, to: url)
    }
  }

  func tabs(_ title: String) -> [SyncedTab] { [SyncedTab(url: URL(string: "https://\(title.lowercased()).example/")!, title: title)] }

  func testARestoredAppSupportFolderNeverReusesASeqWhileTheNewerFileIsDownloading() async throws {
    let client = try await connected()
    await client.publish(openTabs: tabs("A"))
    let backup = storage.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    try FileManager.default.copyItem(at: storage, to: backup)
    await client.publish(openTabs: tabs("B"))
    let id = client.deviceId
    let newest = try XCTUnwrap(try logs("p:personal", from: id).max { $0.seq < $1.seq })
    XCTAssertEqual(newest.seq, 2)
    let unhide = try hide(newest.url)
    try FileManager.default.removeItem(at: storage)
    try FileManager.default.moveItem(at: backup, to: storage)

    let restored = self.client()
    await restored.waitForPendingWork()
    await restored.publish(openTabs: tabs("C"))
    try unhide()
    let seqs = try logs("p:personal", from: restored.deviceId).map(\.seq)
    XCTAssertEqual(seqs.count, Set(seqs).count, "no seq is used twice: \(seqs)")
    XCTAssertTrue(try sentTitles("p:personal", from: restored.deviceId).contains("C"))
  }

  func testRetirementSendsTombstonesOnlyNeverTheRetiringDevicesUnsentTabs() async throws {
    let client = try await connected()
    await client.publish(openTabs: tabs("Sent"))
    let oldId = client.deviceId
    setWritable(false)
    await client.publish(openTabs: tabs("Unsent"))
    client.disconnect()
    await client.waitForPendingWork()
    XCTAssertTrue(client.pendingRetirement)
    setWritable(true)

    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertFalse(relaunched.pendingRetirement)
    XCTAssertFalse(try sentTitles("p:personal", from: oldId).contains("Unsent"))
    XCTAssertTrue(try latest("p:personal", "tabs:\(oldId)") is NSNull)
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
    XCTAssertNil(keyStore.items[oldId])
  }

  func testADisconnectSurvivesTheAppBeingKilledBeforeItsCleanupRan() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    let gate = hold(client.runner)
    client.disconnect()
    XCTAssertEqual(client.state, .notSetUp)

    let relaunched = self.client()
    XCTAssertEqual(relaunched.state, .notSetUp, "the next launch doesn't reconnect")
    XCTAssertNotEqual(relaunched.deviceId, oldId)
    XCTAssertTrue(relaunched.spaces.isEmpty)
    await relaunched.waitForPendingWork()
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
    XCTAssertNil(keyStore.items[oldId])
    XCTAssertFalse(relaunched.pendingRetirement)
    gate.signal()
    await client.waitForPendingWork()
  }

  func testLosingTheWriterRecordRetiresTheOldIdentityAndDeletesItsKey() async throws {
    let client = try await connected()
    await client.publish(openTabs: tabs("Live"))
    let oldId = client.deviceId
    setWritable(false)
    await client.publish(openTabs: tabs("Unsent"))
    setWritable(true)
    try FileManager.default.removeItem(at: storage.appendingPathComponent("writer.json"))

    let relaunched = self.client()
    XCTAssertNotEqual(relaunched.deviceId, oldId, "no seq history, so a new incarnation")
    await relaunched.waitForPendingWork()
    await relaunched.syncNow()
    guard case .idle = relaunched.state else { return XCTFail("state \(relaunched.state)") }
    XCTAssertEqual(relaunched.devices.map(\.name), ["Arman’s MacBook Pro"])
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull, "the old identity is retired")
    XCTAssertTrue(try latest("p:personal", "tabs:\(oldId)") is NSNull)
    XCTAssertFalse(try sentTitles("p:personal", from: oldId).contains("Unsent"))
    XCTAssertNotNil(try latest("app", "dev:\(relaunched.deviceId)") as? [String: Any])
    XCTAssertNil(keyStore.items[oldId], "the displaced identity's key is deleted once it's retired")
    XCTAssertFalse(relaunched.pendingRetirement)
  }

  func testAFullRestoreWithoutTheAppFolderRetiresTheIdentityTheKeychainRemembers() async throws {
    let client = try await connected()
    await client.publish(openTabs: tabs("Before"))
    let oldId = client.deviceId
    try FileManager.default.removeItem(at: storage)

    let restored = self.client()
    XCTAssertEqual(restored.state, .notSetUp)
    XCTAssertNotEqual(restored.deviceId, oldId)
    try restored.connect(folder: folder)
    await restored.waitForPendingWork()
    try await restored.enterRecoveryPhrase(phrase)
    await restored.waitForPendingWork()
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
    XCTAssertTrue(try latest("p:personal", "tabs:\(oldId)") is NSNull)
    XCTAssertNil(keyStore.items[oldId])
    XCTAssertFalse(restored.pendingRetirement)
  }

  func testACloneOnAnotherDeviceNeverWritesUnderTheOriginalsIdNorRetiresIt() async throws {
    let original = try await connected()
    await original.publish(openTabs: tabs("Original"))
    let originalId = original.deviceId
    let copy = storage.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    try FileManager.default.copyItem(at: storage, to: copy)
    defer { try? FileManager.default.removeItem(at: copy) }

    let otherKeychain = MemoryKeyStore()
    let clone = OrbitSyncClient(storageDirectory: copy, keyStore: otherKeychain, deviceName: "Clone", deviceKind: "iphone")
    XCTAssertNotEqual(clone.deviceId, originalId)
    XCTAssertEqual(clone.state, .needsPhrase)
    await clone.waitForPendingWork()
    XCTAssertFalse(clone.pendingRetirement, "a displaced id without its key on this device is dropped")
    try await clone.enterRecoveryPhrase(phrase)
    await clone.publish(openTabs: tabs("Clone"))
    XCTAssertNotNil(try latest("app", "dev:\(originalId)") as? [String: Any], "the original stays")
    XCTAssertEqual(try sentTitles("p:personal", from: originalId), ["Original"])
    XCTAssertEqual(try sentTitles("p:personal", from: clone.deviceId), ["Clone"])
  }

  func testACycleQueuedBeforeDisconnectWritesNothingUnderTheRetiredId() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    _ = try await client.runner.run { $0.openTabs = [SyncedTab(url: URL(string: "https://late.example/")!, title: "Late")] }
    let gate = hold(client.runner)
    let cycle = Task { await client.syncNow() }
    await settle()
    client.disconnect()
    gate.signal()
    await cycle.value
    await client.waitForPendingWork()
    XCTAssertFalse(try sentTitles("p:personal", from: oldId).contains("Late"), "nothing goes out under an id being retired")
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
  }

  func testADisconnectWhoseIntentCantBeSavedKeepsTheConnectionAndWritesNothing() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: storage.path)
    client.disconnect()
    await client.waitForPendingWork()
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: storage.path)
    guard case .failed = client.state else { return XCTFail("state \(client.state)") }
    XCTAssertNotNil(keyStore.items[oldId], "the key stays")
    await client.publish(openTabs: tabs("After"))
    XCTAssertFalse(try sentTitles("p:personal", from: oldId).contains("After"), "a device whose disconnect is half done stops publishing")
    let relaunched = self.client()
    XCTAssertEqual(relaunched.deviceId, oldId)
    guard case .idle = relaunched.state else { return XCTFail("relaunched \(relaunched.state)") }
  }

  func testARetirementRecordOutlivesAKeyDeleteThatDidntHappen() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    keyStore.refuseDeletes(true)
    client.disconnect()
    await client.waitForPendingWork()
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
    XCTAssertNotNil(keyStore.items[oldId])
    XCTAssertTrue(client.pendingRetirement, "the record stays while the key is still there")
    keyStore.refuseDeletes(false)
    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertNil(keyStore.items[oldId])
    XCTAssertFalse(relaunched.pendingRetirement)
  }

  func testARotationWhoseKeyCantBeSavedNeitherCommitsNorLosesTheOldKey() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    keyStore.items[OrbitSyncClient.identityAccount] = nil
    keyStore.refuseSaves(except: [OrbitSyncClient.identityAccount])
    let failing = self.client()
    await failing.waitForPendingWork()
    XCTAssertNotNil(keyStore.items[oldId], "the old key stays until the new one is saved")
    guard case .failed = failing.state else { return XCTFail("state \(failing.state)") }
    XCTAssertNotNil(try latest("app", "dev:\(oldId)") as? [String: Any], "nothing is retired yet")

    keyStore.refuseSaves(except: nil)
    let resumed = self.client()
    await resumed.waitForPendingWork()
    XCTAssertNotEqual(resumed.deviceId, oldId)
    guard case .idle = resumed.state else { return XCTFail("resumed \(resumed.state)") }
    XCTAssertNotNil(keyStore.items[resumed.deviceId])
    XCTAssertTrue(try latest("app", "dev:\(oldId)") is NSNull)
    XCTAssertNil(keyStore.items[oldId])
  }

  func testARotationInterruptedAfterItsRetirementWasSavedIsntReadAsADisconnect() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    keyStore.items[OrbitSyncClient.identityAccount] = nil
    try LocalStorage(directory: storage).saveRetirement(RetirementRecord(device: oldId, bookmark: nil, chain: nil, created: 0))
    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertNotEqual(relaunched.deviceId, oldId)
    guard case .idle = relaunched.state else { return XCTFail("relaunched \(relaunched.state)") }
    XCTAssertTrue(FileManager.default.fileExists(atPath: storage.appendingPathComponent("folder.bookmark").path))
  }

  func otherChainFolder() throws -> (folder: URL, phrase: String) {
    let other = try Paths.scratch("client-other-folder")
    let vault = SyncVault(folder: other, keys: ArdiaSyncCore.SyncKeys(entropy: InteropTests.otherEntropy))
    try vault.createChain()
    let ops: [[String: Any]] = [["k": "prof:work", "h": "0mubbs7i8.0000.othermac", "v": ["n": "Elsewhere", "c": "blue", "i": NSNull(), "d": true]]]
    try vault.write(scope: "app", payload: JSONSerialization.data(withJSONObject: ["v": 1, "kind": "log", "device": "othermac", "seq": 1, "at": 1_790_000_000_000, "ops": ops]))
    return (other, ArdiaSyncCore.RecoveryPhrase.words(for: InteropTests.otherEntropy).joined(separator: " "))
  }

  func testDisconnectingDuringAStuckRotationRetiresBothIdentities() async throws {
    let client = try await connected()
    let a = client.deviceId
    keyStore.items[OrbitSyncClient.identityAccount] = nil
    keyStore.refuseSaves(except: [OrbitSyncClient.identityAccount])
    let stuck = self.client()
    guard case .failed = stuck.state else { return XCTFail("state \(stuck.state)") }
    stuck.disconnect()
    await stuck.waitForPendingWork()
    keyStore.refuseSaves(except: nil)
    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertEqual(relaunched.state, .notSetUp)
    XCTAssertTrue(try latest("app", "dev:\(a)") is NSNull, "the rotation's source is retired too")
    XCTAssertNil(keyStore.items[a])
    XCTAssertFalse(relaunched.pendingRetirement)
  }

  func testAStuckDisconnectRefusesNewConnectionsAndKeepsTheOldKey() async throws {
    let client = try await connected()
    let a = client.deviceId
    keyStore.refuseSaves(except: [])
    client.disconnect()
    await client.waitForPendingWork()
    let other = try otherChainFolder()
    defer { try? FileManager.default.removeItem(at: other.folder) }
    XCTAssertThrowsError(try client.connect(folder: other.folder), "no new connection while a disconnect is half done")
    await client.waitForPendingWork()
    do {
      try await client.enterRecoveryPhrase(other.phrase)
      XCTFail("phrase accepted during a pending disconnect")
    } catch {}
    XCTAssertEqual(keyStore.items[a], entropy, "the retiring identity's key is untouched")
    keyStore.refuseSaves(except: nil)
    let relaunched = self.client()
    await relaunched.waitForPendingWork()
    XCTAssertTrue(try latest("app", "dev:\(a)") is NSNull)
    XCTAssertNil(keyStore.items[a])
  }

  func testARotationWhoseIntentCantBeSavedDoesntHappen() async throws {
    let client = try await connected()
    let a = client.deviceId
    keyStore.items[OrbitSyncClient.identityAccount] = nil
    try FileManager.default.createDirectory(at: storage.appendingPathComponent("transition.json"), withIntermediateDirectories: true)
    let blocked = self.client()
    guard case .failed = blocked.state else { return XCTFail("state \(blocked.state)") }
    XCTAssertEqual(LocalStorage(directory: storage).loadWriter()?.device, a, "nothing is committed without a durable transition")
    try FileManager.default.removeItem(at: storage.appendingPathComponent("transition.json"))
    let resumed = self.client()
    await resumed.waitForPendingWork()
    XCTAssertNotEqual(resumed.deviceId, a)
    guard case .idle = resumed.state else { return XCTFail("resumed \(resumed.state)") }
  }

  func testARetirementNeverCompletesAgainstAnotherChainsFolder() async throws {
    let client = try await connected()
    await client.publish(openTabs: tabs("Here"))
    let a = client.deviceId
    try FileManager.default.removeItem(at: storage)
    let other = try otherChainFolder()
    defer { try? FileManager.default.removeItem(at: other.folder) }
    let restored = self.client()
    try restored.connect(folder: other.folder)
    await restored.waitForPendingWork()
    try await restored.enterRecoveryPhrase(other.phrase)
    await restored.waitForPendingWork()
    guard case .idle = restored.state else { return XCTFail("state \(restored.state)") }
    XCTAssertEqual(keyStore.items[a], entropy, "the key of an identity retired elsewhere stays")
    XCTAssertTrue(restored.pendingRetirement)
    XCTAssertNotNil(try latest("app", "dev:\(a)") as? [String: Any])
  }
}
#endif
