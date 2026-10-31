#if os(macOS)
import Foundation
import XCTest
@testable import OrbitSync

final class ThemeTests: XCTestCase {
  static func oracle() throws -> JSONValue {
    let scratch = try Paths.scratch("themes")
    defer { try? FileManager.default.removeItem(at: scratch) }
    let out = scratch.appendingPathComponent("themes.json")
    try Node.run(["--import", Paths.testLoader.path, "theme-oracle.mjs", out.path])
    return try JSONValue.parse(Data(contentsOf: out))
  }

  static func tsShape(_ look: SyncedThemeLook) -> [String: JSONValue] {
    [
      "stops": .array(look.stops.map { .object(["x": .number($0.x), "y": .number($0.y), "color": .object(["r": .number($0.r), "g": .number($0.g), "b": .number($0.b), "a": .number($0.a)])]) }),
      "intensity": .number(look.intensity),
      "grain": .number(look.grain),
      "texture": .string(look.texture.rawValue),
      "translucency": .number(look.translucency),
    ]
  }

  static func tsShape(_ theme: SyncedTheme?) -> JSONValue {
    guard let theme else { return .null }
    var object = tsShape(theme.light)
    object["mode"] = .string(theme.mode.rawValue)
    if let dark = theme.dark { object["dark"] = .object(tsShape(dark)) }
    return .object(object)
  }

  static func close(_ a: JSONValue?, _ b: JSONValue?, tolerance: Double = 1e-12) -> Bool {
    switch (a, b) {
    case (.number(let x)?, .number(let y)?): return abs(x - y) <= tolerance
    case (.array(let x)?, .array(let y)?): return x.count == y.count && zip(x, y).allSatisfy { close($0, $1, tolerance: tolerance) }
    case (.object(let x)?, .object(let y)?): return Set(x.keys) == Set(y.keys) && x.keys.allSatisfy { close(x[$0], y[$0], tolerance: tolerance) }
    default: return a == b
    }
  }

  func testGlassThemesMatchTheMacsGlassSidebar() throws {
    let glass = try XCTUnwrap(try Self.oracle()["glass"]?.object)
    XCTAssertEqual(glass.count, 10)
    for (color, expected) in glass {
      let actual = Self.tsShape(SyncedTheme.glass(for: color))
      XCTAssertTrue(Self.close(actual, expected), "\(color): \(actual.serialized) vs \(expected.serialized)")
    }
    XCTAssertEqual(SyncedTheme.glass(for: "plum"), SyncedTheme.glass(for: "unknown"))
    XCTAssertNotEqual(SyncedTheme.glass(for: "blue"), SyncedTheme.glass(for: "green"))
  }

  func testThemeRecordsAreSanitizedExactlyLikeTheMac() throws {
    let cases = try XCTUnwrap(try Self.oracle()["sanitized"]?.array)
    XCTAssertGreaterThan(cases.count, 8)
    for (index, item) in cases.enumerated() {
      let actual = Self.tsShape(SyncedTheme(json: item["input"]))
      XCTAssertEqual(actual, item["output"], "case \(index): \(actual.serialized)")
    }
  }

  func testASpaceTakesItsPthRecordOverTheLegacyThemeAndFallsBackToGlass() {
    let custom = JSONValue.object(["stops": .array([.object(["x": .number(0.2), "y": .number(0.3), "color": .object(["r": .number(1), "g": .number(0), "b": .number(0), "a": .number(1)])])]), "mode": .string("dark")])
    let legacy = JSONValue.object(["stops": .array([.object(["x": .number(0.9), "y": .number(0.9), "color": .object(["r": .number(0), "g": .number(1), "b": .number(0)])])])])
    var app = ScopeReplica()
    let origin = Origin(device: "mac", seq: 1)
    func set(_ key: String, _ value: JSONValue) { app.records[key] = SyncRecord(h: "0mubbs7i8.0000.mac", v: value, o: origin) }
    set("prof:withPth", .object(["n": .string("A"), "c": .string("blue"), "i": .null, "th": legacy]))
    set("pth:withPth", .object(["t": custom]))
    set("prof:legacyOnly", .object(["n": .string("B"), "c": .string("green"), "i": .null, "th": legacy]))
    set("prof:preset", .object(["n": .string("C"), "c": .string("red"), "i": .null, "th": legacy]))
    set("pth:preset", .object(["preset": .bool(true)]))
    set("prof:deleted", .object(["n": .string("D"), "c": .string("pink"), "i": .null, "th": legacy]))
    app.records["pth:deleted"] = SyncRecord(h: "0mubbs7i8.0001.mac", v: .null, o: origin)
    set("prof:broken", .object(["n": .string("E"), "c": .string("yellow"), "i": .null]))
    set("pth:broken", .object(["t": .object(["stops": .string("nope")])]))
    set("prof:plain", .object(["n": .string("F"), "c": .string("neutral"), "i": .null, "th": .null]))

    let spaces = Dictionary(uniqueKeysWithValues: ViewBuilder.build(app: app, spaces: [:], me: "phone").spaces.map { ($0.name, $0) })
    XCTAssertEqual(spaces["A"]?.theme?.mode, .dark)
    XCTAssertEqual(spaces["A"]?.theme?.stops.first?.r, 1)
    XCTAssertEqual(spaces["B"]?.theme?.stops.first?.g, 1, "a legacy th applies while there's no pth record")
    XCTAssertEqual(spaces["B"]?.theme?.stops.first?.a, 1)
    XCTAssertNil(spaces["C"]?.theme, "preset: true means the preset colour")
    XCTAssertNil(spaces["D"]?.theme, "a known pth record, even deleted, wins over the legacy th")
    XCTAssertNil(spaces["E"]?.theme)
    XCTAssertNil(spaces["F"]?.theme)
    XCTAssertEqual(spaces["C"]?.color, "red")
    XCTAssertEqual(spaces["C"]?.displayTheme, SyncedTheme.glass(for: "red"))
    XCTAssertEqual(spaces["A"]?.displayTheme, spaces["A"]?.theme)
  }
}
#endif
