import SwiftUI
import UIKit

struct ThemeBackdrop: View {
  let theme: ProfileTheme
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let dark = theme.isDark(appDark: colorScheme == .dark)
    let look = theme.resolved(dark: dark)
    ThemeSurface(look: look, dark: dark)
  }
}

struct ThemeSurface: View, Equatable {
  let look: ThemeLook
  let dark: Bool

  static let gridSize = 4

  var body: some View {
    ZStack {
      Rectangle().fill(dark ? Color(white: 0.1) : Color(white: 0.96))
      Rectangle().fill(dark ? Color.black : Color.white).opacity(ThemeMath.underlayAlpha(look, dark: dark))
      MeshGradient(
        width: Self.gridSize, height: Self.gridSize, points: Self.points, colors: Self.colors(for: look), smoothsColors: true
      )
      .opacity(ThemeMath.layerAlpha(look))
      if ThemeMath.grainAlpha(look) > 0 {
        Rectangle()
          .fill(ImagePaint(image: Image(uiImage: GrainTiles.tile(for: look.texture)), scale: 0.5))
          .opacity(ThemeMath.grainAlpha(look))
          .blendMode(dark ? .plusLighter : .multiply)
      }
    }
    .drawingGroup()
    .allowsHitTesting(false)
  }

  private static let points: [SIMD2<Float>] = (0..<gridSize).flatMap { row in
    (0..<gridSize).map { column in
      SIMD2(Float(column) / Float(gridSize - 1), Float(row) / Float(gridSize - 1))
    }
  }

  static func colors(for look: ThemeLook) -> [Color] {
    (0..<gridSize).flatMap { row in
      (0..<gridSize).map { column in
        let x = Double(column) / Double(gridSize - 1)
        let y = Double(row) / Double(gridSize - 1)
        return Color(rgb: ThemeMath.area(look, x: x, y: y))
      }
    }
  }
}

enum GrainTiles {
  private static var cache: [ThemeTexture: UIImage] = [:]

  static func tile(for texture: ThemeTexture) -> UIImage {
    if let hit = cache[texture] { return hit }
    let side = 96
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    var generator = SeededGenerator(seed: UInt64(texture.rawValue.hashValue & 0xFFFF) &+ 7)
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { context in
      let cg = context.cgContext
      for y in 0..<side {
        for x in 0..<side {
          var value = Double.random(in: 0...1, using: &generator)
          switch texture {
          case .grain: break
          case .sand: value = value > 0.86 ? value : 0.5
          case .denim: value = 0.5 + (value - 0.5) * 0.6 + ((x + y) % 4 < 2 ? 0.18 : -0.18)
          case .tweed: value = 0.5 + (value - 0.5) * 0.5 + ((x / 3 + y / 3) % 2 == 0 ? 0.16 : -0.16)
          }
          cg.setFillColor(gray: CGFloat(min(1, max(0, value))), alpha: 1)
          cg.fill(CGRect(x: x, y: y, width: 1, height: 1))
        }
      }
    }
    cache[texture] = image
    return image
  }
}

struct SeededGenerator: RandomNumberGenerator {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
  }

  mutating func next() -> UInt64 {
    state ^= state << 13
    state ^= state >> 7
    state ^= state << 17
    return state
  }
}
