import OrbitSync

extension ThemeLook {
  init(synced look: SyncedThemeLook) {
    self.init(
      stops: look.stops.prefix(ThemeMath.maxStops).map {
        ThemeStop(x: $0.x, y: $0.y, color: ThemeColor(r: $0.r, g: $0.g, b: $0.b, a: $0.a))
      },
      intensity: look.intensity, grain: look.grain, texture: ThemeTexture(rawValue: look.texture.rawValue) ?? .grain,
      translucency: look.translucency)
  }
}

extension ProfileTheme {
  init(synced theme: SyncedTheme) {
    self.init(
      look: ThemeLook(synced: theme.light), mode: ThemeMode(rawValue: theme.mode.rawValue) ?? .auto,
      dark: theme.dark.map(ThemeLook.init(synced:)))
  }
}
