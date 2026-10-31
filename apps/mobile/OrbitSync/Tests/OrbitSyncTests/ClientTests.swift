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
    XCTAssertTrue(keyStore.items.isEmpty)
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

  func testLosingTheWriterRecordStartsANewDeviceAndKeepsTheOldJournalUnderItsOwnId() async throws {
    let client = try await connected()
    let oldId = client.deviceId
    setWritable(false)
    await client.publish(openTabs: [SyncedTab(url: URL(string: "https://unsent.example/")!, title: "Unsent")])
    guard case .failed = client.state else { return XCTFail("state \(client.state)") }
    setWritable(true)
    try FileManager.default.removeItem(at: storage.appendingPathComponent("writer.json"))

    let relaunched = self.client()
    XCTAssertNotEqual(relaunched.deviceId, oldId, "no seq history, so a new incarnation")
    XCTAssertEqual(relaunched.state, .needsPhrase)
    try await relaunched.enterRecoveryPhrase(phrase)
    guard case .idle = relaunched.state else { return XCTFail("state \(relaunched.state)") }
    let unsent = try latest("p:personal", "tabs:\(oldId)") as? [String: Any]
    XCTAssertEqual((unsent?["tabs"] as? [[String: String]])?.first?["t"], "Unsent", "the journalled batch still went out under its own device")
    XCTAssertNotNil(try latest("app", "dev:\(relaunched.deviceId)") as? [String: Any])
  }
}
#endif
