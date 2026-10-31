import Foundation

struct ThemeColor: Codable, Equatable, Hashable, Sendable {
  var r: Double
  var g: Double
  var b: Double
  var a: Double = 1
}

struct ThemeStop: Codable, Equatable, Hashable, Sendable {
  var x: Double
  var y: Double
  var color: ThemeColor
}

enum ThemeTexture: String, Codable, CaseIterable, Identifiable, Sendable {
  case grain
  case sand
  case denim
  case tweed

  var id: String { rawValue }
  var name: String { rawValue.capitalized }

  var strength: Double {
    switch self {
    case .grain: 0.8
    case .sand: 0.15
    case .denim: 0.6
    case .tweed: 0.4
    }
  }
}

enum ThemeMode: String, Codable, CaseIterable, Identifiable, Sendable {
  case light
  case dark
  case auto

  var id: String { rawValue }

  var title: String {
    switch self {
    case .light: "Light"
    case .dark: "Dark"
    case .auto: "Auto"
    }
  }

  var symbol: String {
    switch self {
    case .light: "sun.max"
    case .dark: "moon"
    case .auto: "circle.lefthalf.filled"
    }
  }
}

struct ThemeLook: Codable, Equatable, Hashable, Sendable {
  var stops: [ThemeStop]
  var intensity: Double
  var grain: Double
  var texture: ThemeTexture
  var translucency: Double
}

struct ProfileTheme: Codable, Equatable, Hashable, Sendable {
  var look: ThemeLook
  var mode: ThemeMode
  var dark: ThemeLook?

  func isDark(appDark: Bool) -> Bool {
    switch mode {
    case .auto: appDark
    case .dark: true
    case .light: false
    }
  }

  func resolved(dark isDark: Bool) -> ThemeLook {
    isDark ? (dark ?? look) : look
  }
}

enum ProfileColor: String, CaseIterable, Identifiable, Sendable {
  case plum
  case blue
  case purple
  case pink
  case red
  case orange
  case yellow
  case green
  case neutral

  var id: String { rawValue }
  var name: String { rawValue.capitalized }

  var swatch: String {
    switch self {
    case .plum: "#C07A98"
    case .blue: "#4691C3"
    case .purple: "#7873AF"
    case .pink: "#D37B8B"
    case .red: "#C1575C"
    case .orange: "#D87249"
    case .yellow: "#E3AC38"
    case .green: "#3EB489"
    case .neutral: "#8E8E93"
    }
  }

  var glassHue: String? {
    switch self {
    case .plum, .neutral: nil
    default: swatch
    }
  }
}

enum ThemeMath {
  static let maxStops = 3
  static let padLightness = 0.6
  static let baseReach = 0.75

  static func clamp01(_ value: Double) -> Double { min(1, max(0, value)) }

  static func hslToRgb(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
    guard s != 0 else { return (l, l, l) }
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s
    let p = 2 * l - q
    func channel(_ value: Double) -> Double {
      var t = value
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1.0 / 6 { return p + (q - p) * 6 * t }
      if t < 0.5 { return q }
      if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
      return p
    }
    return (channel(h + 1.0 / 3), channel(h), channel(h - 1.0 / 3))
  }

  static func rgbToHsl(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let maxValue = max(r, g, b)
    let minValue = min(r, g, b)
    let l = (maxValue + minValue) / 2
    let d = maxValue - minValue
    guard d != 0 else { return (0, 0, l) }
    let s = l > 0.5 ? d / (2 - maxValue - minValue) : d / (maxValue + minValue)
    let h: Double
    if maxValue == r {
      h = (g - b) / d + (g < b ? 6 : 0)
    } else if maxValue == g {
      h = (b - r) / d + 2
    } else {
      h = (r - g) / d + 4
    }
    return (h / 6, s, l)
  }

  static func padColor(x: Double, y: Double) -> ThemeColor {
    let dx = clamp01(x) - 0.5
    let dy = clamp01(y) - 0.5
    var hue = atan2(dy, dx) / (2 * .pi)
    if hue < 0 { hue += 1 }
    let saturation = min(1, hypot(dx, dy) / 0.5)
    let (r, g, b) = hslToRgb(hue, saturation, padLightness)
    return ThemeColor(r: r, g: g, b: b)
  }

  static func padPosition(_ color: ThemeColor) -> (x: Double, y: Double) {
    let (h, s, _) = rgbToHsl(clamp01(color.r), clamp01(color.g), clamp01(color.b))
    let angle = h * 2 * .pi
    return (0.5 + 0.5 * s * cos(angle), 0.5 + 0.5 * s * sin(angle))
  }

  private static func decode(_ v: Double) -> Double {
    let magnitude = abs(v)
    let linear = magnitude <= 0.04045 ? magnitude / 12.92 : pow((magnitude + 0.055) / 1.055, 2.4)
    return v < 0 ? -linear : linear
  }

  private static func encode(_ v: Double) -> Double {
    let magnitude = abs(v)
    let gamma = magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * pow(magnitude, 1 / 2.4) - 0.055
    return v < 0 ? -gamma : gamma
  }

  static func oklab(_ color: ThemeColor) -> (Double, Double, Double) {
    let r = decode(color.r)
    let g = decode(color.g)
    let b = decode(color.b)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    )
  }

  static func fromOklab(_ lab: (Double, Double, Double)) -> (Double, Double, Double) {
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

  static func mixOklab(_ a: ThemeColor, _ b: ThemeColor, _ t: Double) -> (Double, Double, Double) {
    let la = oklab(a)
    let lb = oklab(b)
    return fromOklab((la.0 + (lb.0 - la.0) * t, la.1 + (lb.1 - la.1) * t, la.2 + (lb.2 - la.2) * t))
  }

  static func hexColor(_ hex: String) -> ThemeColor {
    var text = hex
    if text.hasPrefix("#") { text.removeFirst() }
    let value = UInt64(text.prefix(6), radix: 16) ?? 0
    return ThemeColor(
      r: Double((value >> 16) & 0xFF) / 255, g: Double((value >> 8) & 0xFF) / 255, b: Double(value & 0xFF) / 255)
  }

  static func hex(_ color: (Double, Double, Double)) -> String {
    let channels = [color.0, color.1, color.2].map { String(format: "%02X", Int((clamp01($0) * 255).rounded())) }
    return "#" + channels.joined()
  }

  static func area(_ look: ThemeLook, x: Double, y: Double, width: Double = 1, height: Double = 1) -> (Double, Double, Double) {
    guard let c0 = look.stops.first?.color else { return (0.5, 0.5, 0.5) }
    let c1 = look.stops.count > 1 ? look.stops[1].color : c0
    let short = min(width, height)
    let long = max(width, height)
    let start = short / 2 - (short * short) / (2 * long)
    let end = long + short / 2 + (short * short) / (2 * long)
    let t = clamp01((x + y - start) / (end - start) / baseReach)
    let base = mixOklab(c0, c1, t)
    guard look.stops.count > 2 else { return base }
    let c2 = look.stops[2].color
    let alpha = clamp01(y / height) * c2.a
    return (base.0 + (c2.r - base.0) * alpha, base.1 + (c2.g - base.1) * alpha, base.2 + (c2.b - base.2) * alpha)
  }

  static func arcLayerAlpha(_ intensity: Double) -> Double { 0.2 + 0.55 * clamp01(intensity) }

  static func layerAlpha(_ look: ThemeLook) -> Double {
    1 - clamp01(look.translucency) * (1 - arcLayerAlpha(look.intensity))
  }

  static func underlayAlpha(_ look: ThemeLook, dark: Bool) -> Double {
    let arc = min(arcLayerAlpha(look.intensity), 0.5)
    return clamp01(look.translucency) * (dark ? 0.35 * arc : arc)
  }

  static func grainAlpha(_ look: ThemeLook) -> Double {
    clamp01(look.grain) * look.texture.strength
  }

  static func accent(_ look: ThemeLook) -> (Double, Double, Double) {
    area(look, x: 0.5, y: 0.5)
  }

  static func withStop(_ look: ThemeLook, at index: Int, x: Double, y: Double) -> ThemeLook {
    var next = look
    guard next.stops.indices.contains(index) else { return look }
    next.stops[index] = ThemeStop(x: x, y: y, color: padColor(x: x, y: y))
    return next
  }

  static func withColor(_ look: ThemeLook, at index: Int, color: ThemeColor) -> ThemeLook {
    var next = look
    guard next.stops.indices.contains(index) else { return look }
    let position = padPosition(color)
    next.stops[index] = ThemeStop(x: position.x, y: position.y, color: color)
    return next
  }

  static func withAddedStop(_ look: ThemeLook) -> ThemeLook {
    guard look.stops.count < maxStops else { return look }
    let last = look.stops.last ?? ThemeStop(x: 0.8, y: 0.5, color: padColor(x: 0.8, y: 0.5))
    let angle = atan2(last.y - 0.5, last.x - 0.5) + 2 * .pi / 5
    let radius = max(0.3, hypot(last.x - 0.5, last.y - 0.5))
    let x = 0.5 + radius * cos(angle)
    let y = 0.5 + radius * sin(angle)
    var next = look
    next.stops.append(ThemeStop(x: x, y: y, color: padColor(x: x, y: y)))
    return next
  }

  static func withoutStop(_ look: ThemeLook, at index: Int) -> ThemeLook {
    guard look.stops.count > 1, look.stops.indices.contains(index) else { return look }
    var next = look
    next.stops.remove(at: index)
    return next
  }

  static func startingTheme(swatch: String) -> ProfileTheme {
    let base = padPosition(hexColor(swatch))
    let angle = atan2(base.y - 0.5, base.x - 0.5)
    let radius = max(0.3, hypot(base.x - 0.5, base.y - 0.5))
    func stop(_ offset: Double) -> ThemeStop {
      let x = 0.5 + radius * cos(angle + offset)
      let y = 0.5 + radius * sin(angle + offset)
      return ThemeStop(x: x, y: y, color: padColor(x: x, y: y))
    }
    let look = ThemeLook(stops: [stop(-0.45), stop(0.45)], intensity: 0.6, grain: 0, texture: .grain, translucency: 1)
    return ProfileTheme(look: look, mode: .auto, dark: nil)
  }

  private struct GlassStop {
    let hex: String
    let alpha: Double
    let x: Double
    let y: Double
  }

  private static let lightGlassStops = [
    GlassStop(hex: "#EED2B8", alpha: 1, x: 0.2, y: 0.15),
    GlassStop(hex: "#F2DECC", alpha: 1, x: 0.8, y: 0.85),
    GlassStop(hex: "#E2ECCC", alpha: 0.92, x: 0.5, y: 0.95),
  ]

  private static let darkGlassStops = [
    GlassStop(hex: "#3E2E24", alpha: 1, x: 0.2, y: 0.15),
    GlassStop(hex: "#35292A", alpha: 1, x: 0.8, y: 0.85),
    GlassStop(hex: "#2D2A21", alpha: 0.7, x: 0.5, y: 0.95),
  ]

  private static func hue(of hex: String) -> Double {
    let (_, a, b) = oklab(hexColor(hex))
    return atan2(b, a)
  }

  private static func glassLook(_ stops: [GlassStop], turn: Double, chroma: Double) -> ThemeLook {
    let shifted = stops.map { stop -> ThemeStop in
      let (L, a, b) = oklab(hexColor(stop.hex))
      let c = hypot(a, b) * chroma
      let h = atan2(b, a) + turn
      let (r, g, bl) = fromOklab((L, c * cos(h), c * sin(h)))
      return ThemeStop(x: stop.x, y: stop.y, color: ThemeColor(r: r, g: g, b: bl, a: stop.alpha))
    }
    return ThemeLook(stops: shifted, intensity: 0.3, grain: 0, texture: .grain, translucency: 1)
  }

  static func glassTheme(for color: ProfileColor) -> ProfileTheme {
    let peach = hue(of: lightGlassStops[0].hex)
    let turn = color.glassHue.map { hue(of: $0) - peach } ?? 0
    let chroma = color == .neutral ? 0.2 : (color.glassHue != nil ? 1 : 0.45)
    return ProfileTheme(
      look: glassLook(lightGlassStops, turn: turn, chroma: chroma), mode: .auto,
      dark: glassLook(darkGlassStops, turn: turn, chroma: chroma))
  }

  static func nearestPreset(_ hex: String) -> ProfileColor {
    let color = hexColor(hex)
    let (h, s, _) = rgbToHsl(color.r, color.g, color.b)
    if s < 0.12 { return .neutral }
    var best = ProfileColor.plum
    var distance = Double.infinity
    for preset in ProfileColor.allCases where preset != .neutral {
      let swatch = hexColor(preset.swatch)
      let (sh, _, _) = rgbToHsl(swatch.r, swatch.g, swatch.b)
      let d = min(abs(sh - h), 1 - abs(sh - h))
      if d < distance {
        best = preset
        distance = d
      }
    }
    return best
  }
}
