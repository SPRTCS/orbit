#if os(macOS)
import ArdiaSyncCore
import Foundation
import XCTest
@testable import OrbitSync

final class SessionTests: XCTestCase {
  let entropy = InteropTests.entropy
  var folder: URL!
  var storage: URL!
  var mac: SyncVault!

  override func setUpWithError() throws {
    folder = try Paths.scratch("session-folder")
    storage = try Paths.scratch("session-storage")
    mac = SyncVault(folder: folder, keys: ArdiaSyncCore.SyncKeys(entropy: entropy))
    try mac.createChain()
    let profile: [String: Any] = ["v": 1, "kind": "log", "device": "macdevice", "seq": 1, "at": 1_790_000_000_000, "ops": [
      ["k": "prof:personal", "h": "0mubbs7i8.0000.macdevice", "v": ["n": "Personal", "c": "plum", "i": NSNull(), "d": true]],
      ["k": "dev:macdevice", "h": "0mubbs7i8.0001.macdevice", "v": ["n": "Arman’s MacBook Pro"]],
    ]]
    try mac.write(scope: "app", payload: JSONSerialization.data(withJSONObject: profile))
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: folder)
    try? FileManager.default.removeItem(at: storage)
  }

  func session(_ deviceId: String = "phonephonephonephonephone2") throws -> SyncSession {
    let session = SyncSession(storage: LocalStorage(directory: storage), deviceId: deviceId, deviceName: "Arman’s iPhone", deviceKind: "iphone", bookmark: try FolderBookmark.create(for: folder))
    session.gate.open(for: deviceId)
    session.unlock(entropy: entropy)
    return session
  }

  func logs(_ scope: String) throws -> [[String: Any]] {
    try mac.read(scope: scope, skipping: []).files.compactMap { try JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }.filter { $0["device"] as? String == "phonephonephonephonephone2" }
  }

  func testAFailedWriteIsSentAgainByteForByteAfterARelaunchAndSeqsAreNeverReused() throws {
    let first = try session()
    first.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    first.writeFile = { _, _, _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertThrowsError(try first.cycle())
    let journalled = first.journal.map(\.payload)
    XCTAssertEqual(first.journal.map(\.scope), ["app", "p:personal"])
    XCTAssertEqual(try logs("app").count, 0)

    let second = try session()
    XCTAssertEqual(second.journal.map(\.payload), journalled, "the journal survives the relaunch")
    var sent: [String] = []
    second.writeFile = { vault, scope, payload in
      sent.append(String(decoding: payload, as: UTF8.self))
      return try vault.write(scope: scope, payload: payload)
    }
    second.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    _ = try second.cycle()
    XCTAssertEqual(sent, journalled, "the same batches, nothing new: their values already match")
    XCTAssertTrue(second.journal.isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: storage.appendingPathComponent("journal.nns").path))

    second.openTabs = [SyncedTab(url: URL(string: "https://two.example/")!, title: "Two")]
    _ = try second.cycle()
    let tabs = try logs("p:personal").sorted { ($0["seq"] as! Int) < ($1["seq"] as! Int) }
    XCTAssertEqual(tabs.map { $0["seq"] as! Int }, [1, 2])
    let ops = tabs.last?["ops"] as? [[String: Any]]
    XCTAssertEqual(ops?.count, 1)
    XCTAssertEqual(ops?.first?["k"] as? String, "tabs:phonephonephonephonephone2")
    let value = ops?.first?["v"] as? [String: Any]
    XCTAssertEqual(value?["n"] as? String, "Arman’s iPhone")
    XCTAssertEqual(value?["k"] as? String, "iphone")
    XCTAssertEqual((value?["tabs"] as? [[String: String]])?.first, ["u": "https://two.example/", "t": "Two"])
    XCTAssertEqual(try logs("app").map { $0["seq"] as! Int }, [1])

    let count = try mac.read(scope: "p:personal", skipping: []).files.count
    _ = try second.cycle()
    XCTAssertEqual(try mac.read(scope: "p:personal", skipping: []).files.count, count, "an idle cycle writes nothing")
  }

  func phoneFiles(_ scope: String) throws -> [(url: URL, seq: Int)] {
    let directory = mac.chainURL.appendingPathComponent(ArdiaSyncCore.SyncKeys(entropy: entropy).scopeTag(scope))
    let listing = mac.read(scope: scope, skipping: [])
    return try listing.files.compactMap { file in
      let json = try JSONSerialization.jsonObject(with: file.payload) as? [String: Any]
      guard json?["device"] as? String == "phonephonephonephonephone2", let seq = json?["seq"] as? Int else { return nil }
      return (directory.appendingPathComponent("\(file.id).nns"), seq)
    }
  }

  func testALostCacheWhileTheDevicesOwnFileIsStillDownloadingNeverReusesASeq() throws {
    let first = try session()
    first.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    _ = try first.cycle()
    let own = try XCTUnwrap(try phoneFiles("p:personal").first)
    XCTAssertEqual(own.seq, 1)
    try FileManager.default.removeItem(at: storage.appendingPathComponent("state.nns"))
    let hidden = own.url.deletingLastPathComponent().appendingPathComponent(".\(own.url.lastPathComponent).icloud")
    let aside = storage.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    try FileManager.default.moveItem(at: own.url, to: aside)
    try Data().write(to: hidden)

    let second = try session()
    second.openTabs = [SyncedTab(url: URL(string: "https://two.example/")!, title: "Two")]
    _ = try second.cycle()
    try FileManager.default.removeItem(at: hidden)
    try FileManager.default.moveItem(at: aside, to: own.url)
    XCTAssertEqual(try phoneFiles("p:personal").map(\.seq).sorted(), [1, 2], "the phone's second batch gets a new seq")
    XCTAssertEqual(try phoneFiles("app").map(\.seq).sorted(), [1])
  }

  func testReenteringThePhraseAfterTheKeychainLostTheKeyKeepsTheJournal() throws {
    let first = try session()
    first.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    first.writeFile = { _, _, _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertThrowsError(try first.cycle())
    let journalled = first.journal.map(\.payload)
    XCTAssertEqual(journalled.count, 2)

    let locked = SyncSession(storage: LocalStorage(directory: storage), deviceId: "phonephonephonephonephone2", deviceName: "Arman’s iPhone", deviceKind: "iphone", bookmark: try FolderBookmark.create(for: folder))
    locked.gate.open(for: "phonephonephonephonephone2")
    XCTAssertTrue(try locked.adopt(entropy: entropy))
    XCTAssertEqual(locked.journal.map(\.payload), journalled)
    _ = try locked.cycle()
    XCTAssertEqual(try phoneFiles("p:personal").map(\.seq), [1])
    XCTAssertEqual(try phoneFiles("app").map(\.seq), [1])
  }

  func testTheSeqHighWaterMarkIsDurableBeforeAnyBatchIsSent() throws {
    let session = try session()
    session.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    session.saveIdentity = { _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertThrowsError(try session.cycle())
    XCTAssertEqual(try phoneFiles("p:personal").count, 0)
    XCTAssertThrowsError(try session.cycle(), "a batch whose seq isn't durable stays unsent")
    XCTAssertEqual(try phoneFiles("p:personal").count, 0)
    session.saveIdentity = { [storage] in try LocalStorage(directory: storage!).saveWriter($0) }
    _ = try session.cycle()
    XCTAssertEqual(try phoneFiles("p:personal").map(\.seq), [1])
    let chain = ArdiaSyncCore.SyncKeys(entropy: entropy).chainTag
    XCTAssertEqual(LocalStorage(directory: storage).loadWriter()?.seq(chain: chain, scope: "p:personal"), 1)
  }

  func testAnUnreadableJournalIsQuarantinedAndTheWriterAsksToBeReplaced() throws {
    let first = try session()
    first.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    first.writeFile = { vault, scope, payload in
      guard scope == "app" else { throw CocoaError(.fileWriteNoPermission) }
      return try vault.write(scope: scope, payload: payload)
    }
    XCTAssertThrowsError(try first.cycle())
    XCTAssertEqual(first.journal.map(\.scope), ["p:personal"])
    let journal = storage.appendingPathComponent("journal.nns")
    let sealed = try Data(contentsOf: journal)
    try sealed.prefix(sealed.count - 40).write(to: journal)

    let second = try session()
    second.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    XCTAssertTrue(second.needsRotation, "a writer that lost a batch must not go on with a gap in its seqs")
    XCTAssertThrowsError(try second.cycle()) { XCTAssertEqual($0 as? SessionFailure, .needsRotation) }
    XCTAssertEqual(try phoneFiles("p:personal").count, 0)
    let quarantine = storage.appendingPathComponent("quarantine")
    XCTAssertEqual((try? FileManager.default.contentsOfDirectory(atPath: quarantine.path))?.count, 1, "the damaged journal is kept aside")
  }

  func testAQuarantinedJournalStillRequiresRotationAfterARelaunch() throws {
    let first = try session()
    first.openTabs = [SyncedTab(url: URL(string: "https://one.example/")!, title: "One")]
    first.writeFile = { _, _, _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertThrowsError(try first.cycle())
    let journal = storage.appendingPathComponent("journal.nns")
    let sealed = try Data(contentsOf: journal)
    try sealed.prefix(sealed.count - 40).write(to: journal)
    XCTAssertTrue(try session().needsRotation)
    let afterCrash = try session()
    XCTAssertTrue(afterCrash.needsRotation, "the quarantine is remembered until the writer is replaced")
    XCTAssertThrowsError(try afterCrash.cycle())
  }

  func testAWriteThatLandedButReportedFailureDuplicatesTheSameBatchOnly() throws {
    let first = try session()
    first.writeFile = { vault, scope, payload in
      _ = try vault.write(scope: scope, payload: payload)
      throw CocoaError(.fileWriteUnknown)
    }
    XCTAssertThrowsError(try first.cycle())
    let again = try session()
    again.writeFile = { vault, scope, payload in try vault.write(scope: scope, payload: payload) }
    _ = try again.cycle()
    let app = try logs("app")
    XCTAssertEqual(app.count, 2)
    XCTAssertEqual(Set(app.map { $0["seq"] as! Int }), [1])
    XCTAssertEqual(try logs("p:personal").count, 0, "no tabs are published until the app hands some over")
  }

  func testAnExistingScopeThatCantBeListedIsAnErrorNotAQuietSync() throws {
    let session = try session()
    XCTAssertEqual(try session.cycle().spaces.map(\.name), ["Personal"])
    let scope = mac.chainURL.appendingPathComponent(ArdiaSyncCore.SyncKeys(entropy: entropy).scopeTag("app"))
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: scope.path)
    defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scope.path) }
    XCTAssertThrowsError(try session.cycle()) { XCTAssertEqual($0 as? SessionFailure, .folderUnavailable) }
    XCTAssertEqual(session.spaces.count, 1, "an unreadable scope keeps what it had")
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scope.path)
    XCTAssertEqual(try session.cycle().spaces.map(\.name), ["Personal"])
  }

  func testTheChainGoneMeansResetElsewhereAndAMissingFolderMeansUnavailable() throws {
    let session = try session()
    _ = try session.cycle()
    try mac.deleteChain()
    XCTAssertThrowsError(try session.cycle()) { XCTAssertEqual($0 as? SessionFailure, .chainMissing) }
    try FileManager.default.removeItem(at: folder)
    XCTAssertThrowsError(try session.cycle()) { XCTAssertEqual($0 as? SessionFailure, .folderUnavailable) }
  }

  func testPlaceholdersAndHalfCopiedFilesArentAppliedUntilWhole() throws {
    let session = try session()
    _ = try session.cycle()
    let scopeURL = folder.appendingPathComponent(mac.chainURL.lastPathComponent).appendingPathComponent(ArdiaSyncCore.SyncKeys(entropy: entropy).scopeTag("app"))
    let later: [String: Any] = ["v": 1, "kind": "log", "device": "macdevice", "seq": 2, "at": 1_790_000_100_000, "ops": [
      ["k": "prof:work", "h": "0mubbsa00.0000.macdevice", "v": ["n": "Work", "c": "blue", "i": NSNull()]],
    ]]
    let id = try mac.write(scope: "app", payload: JSONSerialization.data(withJSONObject: later))
    let file = scopeURL.appendingPathComponent("\(id).nns")
    let whole = try Data(contentsOf: file)
    try whole.prefix(whole.count / 2).write(to: file)
    XCTAssertEqual(try session.cycle().spaces.map(\.name), ["Personal"])
    XCTAssertEqual(session.app.damaged.keys.sorted(), [id])
    try FileManager.default.removeItem(at: file)
    try Data().write(to: scopeURL.appendingPathComponent(".\(id).nns.icloud"))
    let waiting = try session.cycle()
    XCTAssertEqual(waiting.pending, 1)
    XCTAssertEqual(waiting.spaces.map(\.name), ["Personal"])
    try FileManager.default.removeItem(at: scopeURL.appendingPathComponent(".\(id).nns.icloud"))
    try whole.write(to: file)
    let done = try session.cycle()
    XCTAssertEqual(done.pending, 0)
    XCTAssertEqual(done.spaces.map(\.name), ["Personal", "Work"])
  }

  func testTheLocalCacheHoldsNoPlaintextAndOnlyTheKeysThePhoneShows() throws {
    let secret: [String: Any] = ["v": 1, "kind": "log", "device": "macdevice", "seq": 1, "at": 1_790_000_000_000, "ops": [
      ["k": "pw:https://bank.example\nme", "h": "0mubbs7i8.0000.macdevice", "v": ["o": "https://bank.example", "u": "me", "p": "hunter2-secret"]],
      ["k": "h:https://diary.example/", "h": "0mubbs7i8.0001.macdevice", "v": ["t": "Private diary", "n": 1, "vt": [1]]],
      ["k": "pin:t:abc", "h": "0mubbs7i8.0002.macdevice", "v": ["g": NSNull(), "u": "https://pinned.example/", "t": NSNull(), "i": NSNull(), "ti": "Pinned page", "pos": "V"]],
    ]]
    try mac.write(scope: "p:personal", payload: JSONSerialization.data(withJSONObject: secret))
    let session = try session()
    let views = try session.cycle()
    XCTAssertEqual(views.spaces.first?.pins.map(\.title), ["Pinned page"])
    XCTAssertNil(session.spaces["personal"]?.records["pw:https://bank.example\nme"])
    XCTAssertNil(session.spaces["personal"]?.records["h:https://diary.example/"])
    for name in try FileManager.default.contentsOfDirectory(atPath: storage.path) {
      let data = try Data(contentsOf: storage.appendingPathComponent(name))
      for needle in ["Pinned page", "Personal", "hunter2", "pinned.example", "plum"] {
        XCTAssertNil(data.range(of: Data(needle.utf8)), "\(name) holds \(needle) in the clear")
      }
    }
  }
}
#endif
