import OrbitSync
import SwiftUI

@Observable
final class ThemeStore {
  static let localSpaceID = "local"

  private enum Key {
    static let overrides = "themeOverrides"
    static let appearance = "appAppearance"
    static let accent = "appAccent"
  }

  @ObservationIgnored private let defaults: UserDefaults

  private(set) var overrides: [String: ProfileTheme]

  var appearance: ThemeMode {
    didSet { defaults.set(appearance.rawValue, forKey: Key.appearance) }
  }

  var accentOverride: ThemeColor? {
    didSet {
      if let accentOverride, let data = try? JSONEncoder().encode(accentOverride) {
        defaults.set(data, forKey: Key.accent)
      } else {
        defaults.removeObject(forKey: Key.accent)
      }
    }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    overrides = defaults.data(forKey: Key.overrides).flatMap { try? JSONDecoder().decode([String: ProfileTheme].self, from: $0) } ?? [:]
    appearance = defaults.string(forKey: Key.appearance).flatMap(ThemeMode.init(rawValue:)) ?? .auto
    accentOverride = defaults.data(forKey: Key.accent).flatMap { try? JSONDecoder().decode(ThemeColor.self, from: $0) }
  }

  var colorScheme: ColorScheme? {
    switch appearance {
    case .auto: nil
    case .light: .light
    case .dark: .dark
    }
  }

  func spaceKey(_ space: SyncedSpace?) -> String {
    space?.id ?? Self.localSpaceID
  }

  func hasOverride(for space: SyncedSpace?) -> Bool {
    overrides[spaceKey(space)] != nil
  }

  func baseTheme(for space: SyncedSpace?) -> ProfileTheme {
    guard let space else { return ThemeMath.glassTheme(for: .plum) }
    let theme = ProfileTheme(synced: space.displayTheme)
    return theme.look.stops.isEmpty ? ThemeMath.glassTheme(for: .plum) : theme
  }

  func theme(for space: SyncedSpace?) -> ProfileTheme {
    overrides[spaceKey(space)] ?? baseTheme(for: space)
  }

  func setTheme(_ theme: ProfileTheme, for space: SyncedSpace?) {
    overrides[spaceKey(space)] = theme
    persist()
  }

  func resetTheme(for space: SyncedSpace?) {
    overrides[spaceKey(space)] = nil
    persist()
  }

  func accent(for theme: ProfileTheme, dark: Bool) -> Color {
    if let accentOverride { return Color(theme: accentOverride) }
    return Self.derivedAccent(theme.resolved(dark: theme.isDark(appDark: dark)), dark: dark)
  }

  static func derivedAccent(_ look: ThemeLook, dark: Bool) -> Color {
    let base = ThemeMath.accent(look)
    let target: Double = dark ? 1 : 0
    let amount = dark ? 0.35 : 0.4
    let (h, s, l) = ThemeMath.rgbToHsl(base.0, base.1, base.2)
    let boosted = ThemeMath.hslToRgb(h, max(s, 0.55), l)
    return Color(
      .sRGB, red: boosted.0 + (target - boosted.0) * amount, green: boosted.1 + (target - boosted.1) * amount,
      blue: boosted.2 + (target - boosted.2) * amount)
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(overrides) { defaults.set(data, forKey: Key.overrides) }
  }
}

extension Color {
  init(theme color: ThemeColor) {
    self.init(.sRGB, red: color.r, green: color.g, blue: color.b, opacity: color.a)
  }

  init(rgb: (Double, Double, Double)) {
    self.init(.sRGB, red: rgb.0, green: rgb.1, blue: rgb.2)
  }

  var themeColor: ThemeColor {
    let resolved = UIColor(self).cgColor.converted(
      to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)
    let parts = resolved?.components ?? [0.5, 0.5, 0.5, 1]
    if parts.count >= 3 {
      return ThemeColor(r: Double(parts[0]), g: Double(parts[1]), b: Double(parts[2]), a: Double(parts.count > 3 ? parts[3] : 1))
    }
    return ThemeColor(r: Double(parts[0]), g: Double(parts[0]), b: Double(parts[0]), a: Double(parts.count > 1 ? parts[1] : 1))
  }
}
