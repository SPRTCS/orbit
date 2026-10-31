#if os(macOS)
import ArdiaSyncCore
import Foundation
import XCTest
@testable import OrbitSync

@MainActor
final class InteropTests: XCTestCase {
  nonisolated static let entropy = Data((0..<32).map { UInt8(($0 * 37 + 11) & 0xFF) })
  nonisolated static let otherEntropy = Data((0..<32).map { UInt8(($0 * 53 + 5) & 0xFF) })
  static var words: [String] { ArdiaSyncCore.RecoveryPhrase.words(for: entropy) }

  enum Item: Equatable {
    case leaf(String)
    case folder(String, [Item])

    var json: JSONValue {
      switch self {
      case .leaf(let label): .string(label)
      case .folder(let name, let children): .object([name: .array(children.map(\.json))])
      }
    }
  }

  static func insert(_ label: String, at path: ArraySlice<String>, into items: inout [Item]) {
    guard let name = path.first else {
      items.append(.leaf(label))
      return
    }
    if case .folder(let last, var children) = items.last, last == name {
      insert(label, at: path.dropFirst(), into: &children)
      items[items.count - 1] = .folder(name, children)
    } else {
      var children: [Item] = []
      insert(label, at: path.dropFirst(), into: &children)
      items.append(.folder(name, children))
    }
  }

  static func sidebar(_ pins: [SyncedPin]) -> (tiles: JSONValue, tree: JSONValue, groups: JSONValue) {
    var items: [Item] = []
    for pin in pins where !pin.isTile && pin.groupId == nil {
      insert(pin.url == nil ? "[\(pin.title)]" : pin.title, at: pin.folderPath[...], into: &items)
    }
    var groups: [String: JSONValue] = [:]
    for group in pins where group.url == nil {
      groups[group.title] = .array(pins.filter { $0.groupId == group.id }.map { .string($0.title) })
    }
    return (.array(pins.filter(\.isTile).map { .string($0.title) }), .array(items.map(\.json)), .object(groups))
  }

  static func tabsJSON(_ tabs: [SyncedTab]) -> JSONValue {
    .array(tabs.map { .object(["u": .string($0.url.absoluteString), "t": .string($0.title)]) })
  }

  static func fileCount(_ folder: URL) -> Int {
    let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)
    return (enumerator?.allObjects as? [URL] ?? []).filter { $0.pathExtension == "nns" }.count
  }

  func expectError(_ expected: OrbitSyncError, _ body: () async throws -> Void, line: UInt = #line) async {
    do {
      try await body()
      XCTFail("expected \(expected)", line: line)
    } catch {
      XCTAssertEqual(error as? OrbitSyncError, expected, line: line)
    }
  }

  func assertSidebar(_ space: SyncedSpace?, matches view: JSONValue?, _ message: String, line: UInt = #line) {
    let phone = Self.sidebar(space?.pins ?? [])
    XCTAssertEqual(phone.tiles, view?["tiles"], "\(message): tiles", line: line)
    XCTAssertEqual(phone.tree, view?["tree"], "\(message): pinned rows, groups and folders", line: line)
    XCTAssertEqual(phone.groups, view?["groups"], "\(message): pinned group members", line: line)
  }

  func testPhoneReadsTheMacsAndTheMacsSeeThePhone() async throws {
    let folder = try Paths.scratch("folder")
    let storage = try Paths.scratch("phone")
    defer {
      try? FileManager.default.removeItem(at: folder)
      try? FileManager.default.removeItem(at: storage)
    }
    let macA = try MacDevice(entropy: Self.entropy)
    let macB = try MacDevice(entropy: Self.entropy)
    let a = try macA.command("setupA", ["path": folder.path, "name": "Alex’s MacBook Pro"])
    XCTAssertEqual(a["status"]?.string, "updated", a["error"]?.string ?? "")
    let b = try macB.command("setupB", ["path": folder.path, "name": "Alex’s Mac mini", "phrase": Self.words.joined(separator: " ")])
    XCTAssertEqual(b["status"]?.string, "updated", b["error"]?.string ?? "")
    let aSynced = try macA.command("sync")
    let aId = try XCTUnwrap(a["deviceId"]?.string)
    let bId = try XCTUnwrap(b["deviceId"]?.string)
    let personal = try XCTUnwrap(a["profiles"]?["default"]?["syncId"]?.string)
    XCTAssertEqual(b["profiles"]?["default"]?["syncId"]?.string, personal, "Mac B paired Personal with the synced default")
    let work = try XCTUnwrap(a["profiles"]?.object?.first { $0.key != "default" }?.value["syncId"]?.string)

    let keyStore = MemoryKeyStore()
    let client = OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Alex’s iPhone", deviceKind: "iphone")
    XCTAssertEqual(client.state, .notSetUp)
    await expectError(.notConnected) { try await client.enterRecoveryPhrase(Self.words.joined(separator: " ")) }
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    XCTAssertEqual(client.state, .needsPhrase)

    await expectError(.invalidPhrase("Recovery phrase must be exactly 24 words.")) {
      try await client.enterRecoveryPhrase(Self.words.dropLast().joined(separator: " "))
    }
    await expectError(.invalidPhrase("“zzzz” is not a valid recovery phrase word.")) {
      try await client.enterRecoveryPhrase((["zzzz"] + Self.words.dropFirst()).joined(separator: " "))
    }
    var swapped = Self.words
    swapped.swapAt(0, 1)
    if swapped != Self.words {
      await expectError(.invalidPhrase("This recovery phrase is not valid. Please check for typos.")) {
        try await client.enterRecoveryPhrase(swapped.joined(separator: " "))
      }
    }
    await expectError(.phraseDoesNotMatchFolder) {
      try await client.enterRecoveryPhrase(ArdiaSyncCore.RecoveryPhrase.words(for: Self.otherEntropy).joined(separator: " "))
    }
    XCTAssertNil(keyStore.items[client.deviceId], "a rejected phrase saves nothing")
    let kit = Self.words.enumerated().map { "\($0.offset + 1). \($0.offset.isMultiple(of: 3) ? String($0.element.prefix(4)) : $0.element.uppercased())," }.joined(separator: "\n")
    try await client.enterRecoveryPhrase(kit)
    XCTAssertEqual(keyStore.items[client.deviceId], Self.entropy)
    guard case .idle(let lastSync) = client.state else { return XCTFail("state \(client.state)") }
    XCTAssertNotNil(lastSync)

    XCTAssertEqual(client.spaces.map(\.name), ["Personal", "Work"])
    XCTAssertEqual(client.spaces.map(\.id), [personal, work])
    XCTAssertEqual(client.spaces.map(\.isDefault), [true, false])
    XCTAssertEqual(client.spaces.map(\.color), ["plum", "blue"])
    XCTAssertEqual(client.spaces.map(\.icon), [nil, "briefcase"])
    assertSidebar(client.spaces.first, matches: a["view"], "the phone shows Mac A's pins as its sidebar does")
    XCTAssertTrue(client.spaces[1].pins.isEmpty)

    let devices = Dictionary(uniqueKeysWithValues: client.devices.map { ("\($0.deviceId) \($0.spaceId)", $0) })
    XCTAssertEqual(Set(devices.keys), ["\(aId) \(personal)", "\(aId) \(work)", "\(bId) \(personal)"])
    XCTAssertEqual(devices["\(aId) \(personal)"]?.name, "Alex’s MacBook Pro")
    XCTAssertEqual(devices["\(bId) \(personal)"]?.name, "Alex’s Mac mini")
    XCTAssertEqual(Self.tabsJSON(devices["\(aId) \(personal)"]?.tabs ?? []), aSynced["own"]?[personal]?["tabs"]?["tabs"])
    XCTAssertEqual(Self.tabsJSON(devices["\(aId) \(work)"]?.tabs ?? []), aSynced["own"]?[work]?["tabs"]?["tabs"])
    XCTAssertEqual(devices["\(aId) \(work)"]?.tabs.map(\.title), ["Sprint Board"])
    XCTAssertEqual(Self.tabsJSON(devices["\(bId) \(personal)"]?.tabs ?? []), b["own"]?[personal]?["tabs"]?["tabs"])
    XCTAssertTrue(client.devices.allSatisfy { $0.updatedAt != nil })
    XCTAssertEqual(Set(client.devices.map(\.id)).count, client.devices.count)

    var open = (1...32).map { SyncedTab(url: URL(string: "https://site\($0).example/page?q=\($0)")!, title: "Page \($0) “quoted”") }
    open.insert(SyncedTab(url: URL(string: "file:///Users/me/secret.txt")!, title: "Local"), at: 3)
    open.insert(SyncedTab(url: URL(string: "about:blank")!, title: "Blank"), at: 0)
    await client.publish(openTabs: open)
    let shared = Array(open.filter { $0.url.scheme == "https" }.prefix(30))
    let phoneId = client.deviceId

    for (mac, peer, peerName) in [(macA, bId, "Alex’s Mac mini"), (macB, aId, "Alex’s MacBook Pro")] {
      let remote = try mac.command("remote")
      let seen = remote["remoteTabs"]?["default"]?.array ?? []
      let phone = seen.first { $0["deviceId"]?.string == phoneId }
      XCTAssertEqual(phone?["name"]?.string, "Alex’s iPhone")
      XCTAssertEqual(phone?["tabs"], .array(shared.map { .object(["url": .string($0.url.absoluteString), "title": .string($0.title)]) }))
      XCTAssertNotNil(seen.first { $0["deviceId"]?.string == peer })
      XCTAssertEqual(remote["menu"]?["title"]?.string, "Your Devices")
      XCTAssertEqual(Set((remote["menu"]?["children"]?.array ?? []).compactMap { $0["title"]?.string }), ["Alex’s iPhone", peerName])
      XCTAssertEqual(remote["raw"]?["p:\(personal) tabs:\(phoneId)"]?["k"]?.string, "iphone")
      XCTAssertEqual(remote["raw"]?["p:\(personal) tabs:\(phoneId)"]?["n"]?.string, "Alex’s iPhone")
      XCTAssertNil(remote["raw"]?["p:\(work) tabs:\(phoneId)"] ?? nil)
      XCTAssertEqual(remote["raw"]?["app dev:\(phoneId)"]?["n"]?.string, "Alex’s iPhone")
      XCTAssertTrue((remote["devices"]?.array ?? []).contains { $0["id"]?.string == phoneId && $0["name"]?.string == "Alex’s iPhone" })
    }
    XCTAssertFalse(client.devices.contains { $0.deviceId == phoneId }, "the phone doesn't list itself")

    let before = Self.fileCount(folder)
    await client.publish(openTabs: open)
    await client.syncNow()
    XCTAssertEqual(Self.fileCount(folder), before, "an unchanged value writes nothing")

    let mutated = try macA.command("mutateA")
    try macA.command("compactAll")
    try macB.command("sync")
    try macB.command("compactAll")
    await client.syncNow()
    assertSidebar(client.spaces.first, matches: mutated["view"], "an unpin, a deleted folder and a new row reach the phone through snapshots")
    XCTAssertFalse(client.spaces[0].pins.contains { $0.title == "Docs" })
    XCTAssertEqual(client.devices.first { $0.deviceId == aId && $0.spaceId == personal }?.tabs.map(\.title).contains("Cart"), false)

    let relaunched = OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Alex’s iPhone", deviceKind: "iphone")
    XCTAssertEqual(relaunched.spaces, client.spaces, "the last data shows at launch, before any sync")
    XCTAssertEqual(relaunched.devices, client.devices)
    guard case .idle = relaunched.state else { return XCTFail("relaunched state \(relaunched.state)") }

    try FileManager.default.removeItem(at: storage.appendingPathComponent("state.nns"))
    let forgetful = OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Alex’s iPhone", deviceKind: "iphone")
    XCTAssertTrue(forgetful.spaces.isEmpty)
    let later = [SyncedTab(url: URL(string: "https://after-compaction.example/")!, title: "After compaction")]
    await forgetful.publish(openTabs: later)
    XCTAssertEqual(forgetful.spaces.map(\.name), ["Personal", "Work"])
    let afterCompaction = try macA.command("remote")
    let phoneSeen = (afterCompaction["remoteTabs"]?["default"]?.array ?? []).first { $0["deviceId"]?.string == phoneId }
    XCTAssertEqual(phoneSeen?["tabs"]?.array?.compactMap { $0["title"]?.string }, ["After compaction"], "a phone that lost its cache takes its next seq from the folder, so the Mac applies its new batch")

    forgetful.disconnect()
    XCTAssertEqual(forgetful.state, .notSetUp)
    XCTAssertTrue(forgetful.spaces.isEmpty)
    await forgetful.waitForPendingWork()
    XCTAssertNil(keyStore.items[phoneId])
    XCTAssertNotEqual(forgetful.deviceId, phoneId)
    for item in ["state.nns", "journal.nns", "folder.bookmark"] {
      XCTAssertFalse(FileManager.default.fileExists(atPath: storage.appendingPathComponent(item).path), item)
    }
    let gone = try macA.command("remote")
    XCTAssertFalse((gone["remoteTabs"]?["default"]?.array ?? []).contains { $0["deviceId"]?.string == phoneId })
    XCTAssertFalse((gone["devices"]?.array ?? []).contains { $0["id"]?.string == phoneId }, "disconnecting removes the phone from the Macs")
  }

  func testALostJournalLeavesNoSeqGapSoTheMacsStillCompact() async throws {
    let folder = try Paths.scratch("gap-folder")
    let storage = try Paths.scratch("gap-phone")
    defer {
      try? FileManager.default.removeItem(at: folder)
      try? FileManager.default.removeItem(at: storage)
    }
    let mac = try MacDevice(entropy: Self.entropy)
    let a = try mac.command("setupA", ["path": folder.path, "name": "Alex’s MacBook Pro"])
    let personal = try XCTUnwrap(a["profiles"]?["default"]?["syncId"]?.string)
    let keyStore = MemoryKeyStore()
    let client = OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Alex’s iPhone", deviceKind: "iphone")
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    try await client.enterRecoveryPhrase(Self.words.joined(separator: " "))
    await client.publish(openTabs: [SyncedTab(url: URL(string: "https://a.example/")!, title: "A")])
    let firstId = client.deviceId

    let keys = ArdiaSyncCore.SyncKeys(entropy: Self.entropy)
    let scopeDir = folder.appendingPathComponent(keys.chainTag).appendingPathComponent(keys.scopeTag("p:\(personal)"))
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: scopeDir.path)
    await client.publish(openTabs: [SyncedTab(url: URL(string: "https://b.example/")!, title: "B")])
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scopeDir.path)
    let journal = storage.appendingPathComponent("journal.nns")
    let sealed = try Data(contentsOf: journal)
    try sealed.prefix(sealed.count - 40).write(to: journal)

    let relaunched = OrbitSyncClient(storageDirectory: storage, keyStore: keyStore, deviceName: "Alex’s iPhone", deviceKind: "iphone")
    await relaunched.waitForPendingWork()
    await relaunched.publish(openTabs: [SyncedTab(url: URL(string: "https://b.example/")!, title: "B")])
    guard case .idle = relaunched.state else { return XCTFail("state \(relaunched.state)") }

    try mac.command("compactAll")
    try mac.command("sync")
    try mac.command("compactAll")
    let scopes = try mac.command("scopes")
    for (scope, value) in scopes.object ?? [:] {
      XCTAssertEqual(value["extra"], .object([:]), "\(scope) has a seq gap that stops compaction")
    }
    let remote = try mac.command("remote")
    let phone = (remote["remoteTabs"]?["default"]?.array ?? []).filter { $0["name"]?.string == "Alex’s iPhone" }
    XCTAssertEqual(phone.count, 1)
    XCTAssertEqual(phone.first?["tabs"]?.array?.compactMap { $0["title"]?.string }, ["B"])
    XCTAssertNotEqual(phone.first?["deviceId"]?.string, firstId, "the writer whose journal was lost is replaced")
  }

  func phoneReading(_ scenario: [String: Any]) async throws -> (mac: JSONValue, space: SyncedSpace?) {
    let folder = try Paths.scratch("folders-folder")
    let storage = try Paths.scratch("folders-phone")
    defer {
      try? FileManager.default.removeItem(at: folder)
      try? FileManager.default.removeItem(at: storage)
    }
    let mac = try MacDevice(entropy: Self.entropy)
    var args = scenario
    args["path"] = folder.path
    args["name"] = "Alex’s MacBook Pro"
    let result = try mac.command("setupFolders", args)
    let client = OrbitSyncClient(storageDirectory: storage, keyStore: MemoryKeyStore(), deviceName: "Alex’s iPad", deviceKind: "ipad")
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    try await client.enterRecoveryPhrase(Self.words.joined(separator: " "))
    return (result, client.spaces.first { $0.isDefault })
  }

  func testPinnedFoldersWithRowsGroupsAndAppearanceReachThePhone() async throws {
    for syncFirst in [false, true] {
      let (mac, space) = try await phoneReading(["syncFirst": syncFirst])
      let pins = space?.pins ?? []
      XCTAssertEqual(pins.filter(\.isTile).map(\.title), (1...6).map { "Tile \($0)" }, "syncFirst \(syncFirst)")
      assertSidebar(space, matches: mac["view"], "folders built \(syncFirst ? "after" : "before") sync was turned on")
      XCTAssertEqual(pins.first { $0.title == "Deep Row" }?.folderPath, ["MLP", "Inner"])
      XCTAssertEqual(pins.first { $0.title == "Crew A" }?.folderPath, ["MLP"])
      let mlp = space?.folders.first { $0.name == "MLP" }
      XCTAssertEqual(mlp?.emoji, "🟡")
      XCTAssertEqual(mlp?.color, "yellow")
      XCTAssertEqual(space?.folders.first { $0.name == "Inner" }?.path, ["MLP", "Inner"])
    }
  }

  func copiedMac(originalWritesAfterCopy: Int) async throws -> (pins: [SyncedPin], mac: JSONValue, original: JSONValue, sameDevice: Bool, collisions: Int) {
    let folder = try Paths.scratch("copy-folder")
    let storage = try Paths.scratch("copy-phone")
    defer {
      try? FileManager.default.removeItem(at: folder)
      try? FileManager.default.removeItem(at: storage)
    }
    let original = try MacDevice(entropy: Self.entropy)
    let a = try original.command("setupFolders", ["path": folder.path, "name": "Alex’s MacBook Pro", "tilesOnly": true])
    let docs = try original.command("exportDocs").object?.mapValues { $0.string ?? "" } ?? [:]
    try original.command("openTabs", ["count": originalWritesAfterCopy])
    let copy = try MacDevice(entropy: Self.entropy)
    let b = try copy.command("setupFolders", ["path": folder.path, "name": "Alex’s MacBook Pro", "docs": docs, "dataDirectoryId": "volume:2"])
    XCTAssertEqual(b["status"]?.string, "updated")
    let client = OrbitSyncClient(storageDirectory: storage, keyStore: MemoryKeyStore(), deviceName: "Alex’s iPad", deviceKind: "ipad")
    try client.connect(folder: folder)
    await client.waitForPendingWork()
    try await client.enterRecoveryPhrase(Self.words.joined(separator: " "))
    let vault = ArdiaSyncCore.SyncVault(folder: folder, keys: ArdiaSyncCore.SyncKeys(entropy: Self.entropy))
    var batches: [String: Set<Data>] = [:]
    for scope in ["app", "p:\(b["profiles"]?["default"]?["syncId"]?.string ?? "")"] {
      for file in vault.read(scope: scope, skipping: []).files {
        guard let json = try? JSONSerialization.jsonObject(with: file.payload) as? [String: Any], json["kind"] as? String == "log",
              let device = json["device"] as? String, let seq = json["seq"] as? Int else { continue }
        batches["\(scope) \(device) \(seq)", default: []].insert(file.payload)
      }
    }
    let collisions = batches.values.filter { $0.count > 1 }.count
    let originalSidebar = try original.command("sidebar")
    return (client.spaces.first { $0.isDefault }?.pins ?? [], b, originalSidebar, a["deviceId"] == b["deviceId"], collisions)
  }

  func testAMacStartedFromACopiedDataDirJoinsAsANewDeviceSoItsFoldersReachEveryone() async throws {
    for writes in [0, 4] {
      let copied = try await copiedMac(originalWritesAfterCopy: writes)
      XCTAssertFalse(copied.sameDevice, "the copy takes a device id of its own")
      XCTAssertEqual(copied.collisions, 0, "no batch reuses a device and seq")
      XCTAssertTrue(copied.mac["view"]?.serialized.contains("MLP") ?? false)
      XCTAssertTrue(copied.original["view"]?.serialized.contains("MLP") ?? false, "the original Mac now gets the copy's folder")
      XCTAssertEqual(Set(copied.pins.filter(\.isTile).map(\.title)), Set((1...6).map { "Tile \($0)" }))
      XCTAssertEqual(copied.pins.first { $0.title == "Deep Row" }?.folderPath, ["MLP", "Inner"], "and so does the phone")
      XCTAssertEqual(copied.pins.first { $0.title == "MLP One" }?.folderPath, ["MLP"])
      XCTAssertEqual(copied.pins.first { $0.title == "Crew A" }?.folderPath, ["MLP"])
    }
  }
}
#endif
