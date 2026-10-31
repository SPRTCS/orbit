#if os(macOS)
import Foundation
import XCTest
@testable import OrbitSync

final class MergeTests: XCTestCase {
  func testClockFormatMatchesHlcTs() {
    XCTAssertEqual(HybridClock.format(wall: 1_790_000_000_000, counter: 3, device: "dev.a"), "0mubbs7i8.0003.dev.a")
    var clock = HybridClock(device: "me", last: "0mubbs7i8.0009.other")
    XCTAssertEqual(clock.tick(now: 1_789_999_999_000), "0mubbs7i8.000a.me")
    XCTAssertEqual(clock.tick(now: 1_790_000_000_001), "0mubbs7i9.0000.me")
    XCTAssertEqual(HybridClock.wall(of: "0mubbs7i8.0003.dev"), 1_790_000_000_000)
  }

  func testSerializationMatchesJsonStringify() throws {
    let value = JSONValue.object([
      "b": .string("x\u{1}\"\\\n\t\u{2028}é😀"),
      "a": .array([.number(1), .number(2.5), .number(-0.0), .number(1e21), .null, .bool(true)]),
    ])
    XCTAssertEqual(value.serialized, #"{"a":[1,2.5,0,1e+21,null,true],"b":"x\u0001\"\\\n\t\#u{2028}é😀"}"#)
    XCTAssertEqual(try JSONValue.parse(value.data), value.serializedRoundTrip)
  }

  func testReplicaMatchesScopeTsOnRandomHistories() throws {
    try replay(keep: { _ in true })
  }

  func testReplicaKeepingSomeKeysMatchesScopeTsForThoseKeys() throws {
    try replay(keep: { ["x:1", "x:3", "x:5"].contains($0) })
  }

  private func replay(keep: @escaping (String) -> Bool) throws {
    let scratch = try Paths.scratch("oracle")
    defer { try? FileManager.default.removeItem(at: scratch) }
    let out = scratch.appendingPathComponent("runs.json")
    try Node.run(["replica-oracle.mjs", out.path, "40", "11"])
    let runs = try JSONValue.parse(Data(contentsOf: out)).array ?? []
    XCTAssertEqual(runs.count, 40)
    var compared = 0
    for (runIndex, run) in runs.enumerated() {
      var replica = ScopeReplica()
      var clock = HybridClock(device: "phone")
      for (index, delivery) in (run["deliveries"]?.array ?? []).enumerated() {
        let raw = delivery["listing"]!
        let listing = FolderListing(
          files: (raw["files"]?.array ?? []).map { ListedFile(id: $0["id"]!.string!, payload: Data($0["payload"]!.string!.utf8)) },
          pending: (raw["pending"]?.array ?? []).compactMap(\.string),
          damaged: (raw["damaged"]?.array ?? []).compactMap(\.string),
          present: (raw["present"]?.array ?? []).compactMap(\.string)
        )
        replica.pull(listing, now: delivery["now"]!.number!, clock: &clock, keep: keep)
        var expected = delivery["expected"]!.object!
        if let records = expected["records"]?.object { expected["records"] = .object(records.filter { keep($0.key) }) }
        let actual = Self.tsShape(replica, clock)
        if case .object(let actualObject) = actual {
          for key in expected.keys.sorted() {
            XCTAssertEqual(actualObject[key], expected[key], "run \(runIndex) delivery \(index): \(key)")
          }
        }
        compared += 1
      }
    }
    XCTAssertGreaterThan(compared, 500)
  }

  static func tsShape(_ replica: ScopeReplica, _ clock: HybridClock) -> JSONValue {
    var object = replica.json.object!
    object["records"] = .object(replica.records.mapValues { .object(["h": .string($0.h), "v": $0.v, "o": $0.o.json]) })
    object["pendingSince"] = replica.pendingSince.map { .object($0.mapValues { .number($0) }) } ?? .null
    object["clock"] = .string(clock.last)
    object["seq"] = nil
    return .object(object)
  }

  func testPinsFollowPositionsGroupsAndFolders() {
    var scope = ScopeReplica()
    let origin = Origin(device: "mac", seq: 1)
    func set(_ key: String, _ value: JSONValue) { scope.records[key] = SyncRecord(h: "0mubbs7i8.0000.mac", v: value, o: origin) }
    func tab(_ id: String, _ title: String, group: String? = nil, pos: String) {
      set("pin:t:\(id)", .object(["g": group.map(JSONValue.string) ?? .null, "u": .string("https://\(id).example/"), "t": .null, "i": .null, "ti": .string(title), "pos": .string(pos)]))
    }
    tab("t1", "Mail", pos: "V")
    tab("t2", "Calendar", pos: "C")
    tab("r1", "Docs", pos: "a")
    tab("r2", "Notes", pos: "b")
    tab("r3", "Spec", pos: "c")
    tab("r4", "Orphan", pos: "d")
    tab("m1", "Second", group: "g1", pos: "b")
    tab("m2", "First", group: "g1", pos: "a")
    tab("m3", "Lost member", group: "gone", pos: "a")
    set("pin:t:custom", .object(["g": .null, "u": .string("https://custom.example/"), "t": .string("Custom name"), "i": .null, "ti": .string("Page"), "pos": .string("e")]))
    set("pin:g:g1", .object(["n": .string("Team"), "i": .null, "c": .string("blue"), "pos": .string("V")]))
    scope.records["pin:t:dead"] = SyncRecord(h: "0mubbs7i8.0000.mac", v: .null, o: origin)
    for id in ["r1", "r2", "r3", "r4", "m3", "custom"] { set("pinrow:\(id)", .number(1)) }
    set("pinrow:t1", .number(0))
    set("pinfolder:f:p", .object(["n": .string("Projects"), "p": .null, "pos": .string("b")]))
    set("pinfolder:f:i", .object(["n": .string("Inner"), "p": .string("p"), "pos": .string("b")]))
    set("pinfolder:f:x", .object(["n": .string("Loop X"), "p": .string("y"), "pos": .string("c")]))
    set("pinfolder:f:y", .object(["n": .string("Loop Y"), "p": .string("x"), "pos": .string("a")]))
    set("pinfolder:t:r1", .object(["p": .null, "pos": .string("a")]))
    set("pinfolder:t:r2", .object(["p": .string("p"), "pos": .string("a")]))
    set("pinfolder:t:r3", .object(["p": .string("i"), "pos": .string("a")]))
    set("pinfolder:g:g1", .object(["p": .string("missing"), "pos": .string("z")]))
    set("pinfolder:t:custom", .object(["p": .string("y"), "pos": .string("a")]))
    set("pinfolder:t:dead", .object(["p": .null, "pos": .string("0")]))
    set("pinfolder:a:p", .object(["e": .string("📁")]))

    let pins = ViewBuilder.pins(in: scope)
    let summary = pins.map { "\($0.id)|\($0.title)|\($0.folderPath.joined(separator: "/"))|\($0.groupId ?? "")|\($0.isTile ? "tile" : "")" }
    XCTAssertEqual(summary, [
      "t:t2|Calendar|||tile",
      "t:t1|Mail|||tile",
      "t:r1|Docs|||",
      "t:r2|Notes|Projects||",
      "t:r3|Spec|Projects/Inner||",
      "t:custom|Custom name|Loop X/Loop Y||",
      "g:g1|Team|||",
      "t:m2|First||g:g1|",
      "t:m1|Second||g:g1|",
      "t:m3|Lost member|||",
      "t:r4|Orphan|||",
    ])
    XCTAssertNil(pins.first { $0.id == "g:g1" }?.url)
    XCTAssertEqual(pins.filter(\.isGroup).map(\.id), ["g:g1"])
    let folders = ViewBuilder.pinned(in: scope).folders
    XCTAssertEqual(folders.map(\.path), [["Projects"], ["Projects", "Inner"], ["Loop X"], ["Loop X", "Loop Y"]])
    XCTAssertEqual(folders.first?.emoji, "📁")
    XCTAssertEqual(folders[1].parentId, "f:p")
    XCTAssertEqual(pins.first { $0.title == "Spec" }?.folderId, "f:i")
    XCTAssertEqual(pins.first { $0.id == "t:t1" }?.url, URL(string: "https://t1.example/"))
  }
}

extension JSONValue {
  var serializedRoundTrip: JSONValue {
    switch self {
    case .number(let value) where value == 0: .number(0)
    case .array(let values): .array(values.map(\.serializedRoundTrip))
    case .object(let object): .object(object.mapValues(\.serializedRoundTrip))
    default: self
    }
  }
}
#endif
