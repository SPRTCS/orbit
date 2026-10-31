import Foundation

public enum SyncedThemeMode: String, Hashable, Sendable, CaseIterable {
  case auto
  case light
  case dark
}

public enum SyncedThemeTexture: String, Hashable, Sendable, CaseIterable {
  case grain
  case sand
  case denim
  case tweed
}

public struct SyncedThemeStop: Hashable, Sendable {
  public var x: Double
  public var y: Double
  public var r: Double
  public var g: Double
  public var b: Double
  public var a: Double

  public init(x: Double, y: Double, r: Double, g: Double, b: Double, a: Double) {
    self.x = x
    self.y = y
    self.r = r
    self.g = g
    self.b = b
    self.a = a
  }
}

public struct SyncedThemeLook: Hashable, Sendable {
  public var stops: [SyncedThemeStop]
  public var intensity: Double
  public var grain: Double
  public var texture: SyncedThemeTexture
  public var translucency: Double

  public init(stops: [SyncedThemeStop], intensity: Double, grain: Double, texture: SyncedThemeTexture, translucency: Double) {
    self.stops = stops
    self.intensity = intensity
    self.grain = grain
    self.texture = texture
    self.translucency = translucency
  }
}

public struct SyncedTheme: Hashable, Sendable {
  public static let maxStops = 3

  public var stops: [SyncedThemeStop]
  public var intensity: Double
  public var grain: Double
  public var texture: SyncedThemeTexture
  public var translucency: Double
  public var mode: SyncedThemeMode
  public var dark: SyncedThemeLook?

  public init(stops: [SyncedThemeStop], intensity: Double, grain: Double, texture: SyncedThemeTexture, translucency: Double, mode: SyncedThemeMode, dark: SyncedThemeLook? = nil) {
    self.stops = stops
    self.intensity = intensity
    self.grain = grain
    self.texture = texture
    self.translucency = translucency
    self.mode = mode
    self.dark = dark
  }

  public init(look: SyncedThemeLook, mode: SyncedThemeMode, dark: SyncedThemeLook? = nil) {
    self.init(stops: look.stops, intensity: look.intensity, grain: look.grain, texture: look.texture, translucency: look.translucency, mode: mode, dark: dark)
  }

  public var light: SyncedThemeLook {
    SyncedThemeLook(stops: stops, intensity: intensity, grain: grain, texture: texture, translucency: translucency)
  }

  public func isDark(appDark: Bool) -> Bool {
    mode == .auto ? appDark : mode == .dark
  }

  public func look(dark: Bool) -> SyncedThemeLook {
    dark ? (self.dark ?? light) : light
  }
}

extension SyncedTheme {
  static let maxParsedStops = 16

  init?(json: JSONValue?) {
    guard let json, let look = Self.look(json) else { return nil }
    let mode = json["mode"]?.string.flatMap { $0 == "light" || $0 == "dark" ? SyncedThemeMode(rawValue: $0) : nil } ?? .auto
    self.init(look: look, mode: mode, dark: Self.look(json["dark"]))
  }

  init?(record: JSONValue?) {
    guard let record, record.object != nil else { return nil }
    if record["preset"]?.bool == true { return nil }
    guard let theme = record["t"] else { return nil }
    self.init(json: theme)
  }

  private static func clamp01(_ value: Double) -> Double { min(1, max(0, value)) }

  private static func number(_ value: JSONValue?, _ fallback: Double) -> Double {
    guard let value = value?.number, value.isFinite else { return fallback }
    return value
  }

  private static func look(_ json: JSONValue?) -> SyncedThemeLook? {
    guard let json, json.object != nil, let rawStops = json["stops"]?.array else { return nil }
    var stops: [SyncedThemeStop] = []
    for raw in rawStops.prefix(maxParsedStops) {
      if stops.count >= maxStops { break }
      guard let color = raw["color"], color.object != nil else { continue }
      guard let r = color["r"]?.number, let g = color["g"]?.number, let b = color["b"]?.number,
            [r, g, b].allSatisfy({ $0.isFinite && abs($0) < 4 }) else { continue }
      stops.append(SyncedThemeStop(
        x: clamp01(number(raw["x"], 0.5)),
        y: clamp01(number(raw["y"], 0.5)),
        r: r, g: g, b: b,
        a: clamp01(number(color["a"], 1))
      ))
    }
    guard !stops.isEmpty else { return nil }
    return SyncedThemeLook(
      stops: stops,
      intensity: clamp01(number(json["intensity"], 0.6)),
      grain: clamp01(number(json["grain"], 0)),
      texture: json["texture"]?.string.flatMap(SyncedThemeTexture.init(rawValue:)) ?? .grain,
      translucency: clamp01(number(json["translucency"], 1))
    )
  }
}

extension SyncedTheme {
  private struct GlassStop {
    var hex: String
    var alpha: Double
    var x: Double
    var y: Double
  }

  private static let swatchHues: [String: String] = [
    "blue": "#4691C3",
    "purple": "#7873AF",
    "pink": "#D37B8B",
    "red": "#C1575C",
    "orange": "#D87249",
    "yellow": "#E3AC38",
    "green": "#3EB489",
  ]

  private static let glassLight = [
    GlassStop(hex: "#EED2B8", alpha: 1, x: 0.2, y: 0.15),
    GlassStop(hex: "#F2DECC", alpha: 1, x: 0.8, y: 0.85),
    GlassStop(hex: "#E2ECCC", alpha: 0.92, x: 0.5, y: 0.95),
  ]

  private static let glassDark = [
    GlassStop(hex: "#3E2E24", alpha: 1, x: 0.2, y: 0.15),
    GlassStop(hex: "#35292A", alpha: 1, x: 0.8, y: 0.85),
    GlassStop(hex: "#2D2A21", alpha: 0.7, x: 0.5, y: 0.95),
  ]

  public static func glass(for color: String) -> SyncedTheme {
    let swatch = swatchHues[color]
    let turn = swatch.map { hue(of: $0) - hue(of: glassLight[0].hex) } ?? 0
    let chroma = color == "neutral" ? 0.2 : swatch != nil ? 1 : 0.45
    func look(_ stops: [GlassStop]) -> SyncedThemeLook {
      SyncedThemeLook(stops: stops.map { shifted($0, turn: turn, chroma: chroma) }, intensity: 0.3, grain: 0, texture: .grain, translucency: 1)
    }
    return SyncedTheme(look: look(glassLight), mode: .auto, dark: look(glassDark))
  }

  private static func hue(of hex: String) -> Double {
    let lab = ThemeColorMath.oklab(ThemeColorMath.hexColor(hex))
    return atan2(lab.2, lab.1)
  }

  private static func shifted(_ stop: GlassStop, turn: Double, chroma: Double) -> SyncedThemeStop {
    let (L, a, b) = ThemeColorMath.oklab(ThemeColorMath.hexColor(stop.hex))
    let c = hypot(a, b) * chroma
    let h = atan2(b, a) + turn
    let (r, g, bl) = ThemeColorMath.fromOklab((L, c * cos(h), c * sin(h)))
    return SyncedThemeStop(x: stop.x, y: stop.y, r: r, g: g, b: bl, a: stop.alpha)
  }
}

enum ThemeColorMath {
  typealias Triple = (Double, Double, Double)

  static func sign(_ v: Double) -> Double { v > 0 ? 1 : v < 0 ? -1 : v }

  static func decode(_ v: Double) -> Double {
    sign(v) * (abs(v) <= 0.04045 ? abs(v) / 12.92 : pow((abs(v) + 0.055) / 1.055, 2.4))
  }

  static func encode(_ v: Double) -> Double {
    sign(v) * (abs(v) <= 0.0031308 ? abs(v) * 12.92 : 1.055 * pow(abs(v), 1 / 2.4) - 0.055)
  }

  static func hexColor(_ hex: String) -> Triple {
    let digits = Array(hex.utf8.dropFirst())
    func channel(_ i: Int) -> Double {
      guard digits.count >= 2 * i + 2, let value = Int(String(decoding: digits[(2 * i)..<(2 * i + 2)], as: UTF8.self), radix: 16) else { return .nan }
      return Double(value) / 255
    }
    return (channel(0), channel(1), channel(2))
  }

  static func oklab(_ c: Triple) -> Triple {
    let (r, g, b) = (decode(c.0), decode(c.1), decode(c.2))
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    )
  }

  static func fromOklab(_ lab: Triple) -> Triple {
    let (L, A, B) = lab
    let l = pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
    let m = pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
    let s = pow(L - 0.0894841775 * A - 1.291485548 * B, 3)
    return (
      encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    )
  }
}
