import OrbitSync
import SwiftUI

struct OrbitBackdrop: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    ThemeBackdrop(theme: browser.currentTheme)
  }
}

struct OrbitMark: View {
  var size: CGFloat = 64

  var body: some View {
    ZStack {
      Ellipse()
        .stroke(.white.opacity(0.55), lineWidth: size * 0.05)
        .frame(width: size, height: size * 0.36)
        .rotationEffect(.degrees(-22))
      Circle()
        .fill(
          RadialGradient(
            colors: [.white, Color(red: 0.86, green: 0.84, blue: 0.98)], center: UnitPoint(x: 0.35, y: 0.3),
            startRadius: 0, endRadius: size * 0.3)
        )
        .frame(width: size * 0.42, height: size * 0.42)
      Circle()
        .fill(.white)
        .frame(width: size * 0.12, height: size * 0.12)
        .offset(x: size * 0.42, y: -size * 0.2)
    }
    .frame(width: size * 1.1, height: size)
    .padding(size * 0.18)
    .background(
      LinearGradient(
        colors: [Color(red: 0.55, green: 0.58, blue: 0.98), Color(red: 0.73, green: 0.55, blue: 0.96), Color(red: 0.96, green: 0.62, blue: 0.80)],
        startPoint: .topLeading, endPoint: .bottomTrailing),
      in: RoundedRectangle(cornerRadius: size * 0.36, style: .continuous))
  }
}

extension Color {
  init?(hex: String) {
    var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt64(text, radix: 16) else { return nil }
    let hasAlpha = text.count == 8
    let red = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
    let green = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
    let blue = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
    let alpha = hasAlpha ? Double(value & 0xFF) / 255 : 1
    self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
  }
}

extension SyncedSpace {
  var tint: Color {
    color.flatMap(Color.init(hex:)) ?? .accentColor
  }
}

struct SpaceIcon: View {
  let space: SyncedSpace
  var size: CGFloat = 18

  var body: some View {
    Group {
      if let icon = space.icon, !icon.isEmpty {
        if UIImage(systemName: icon) != nil {
          Image(systemName: icon).foregroundStyle(space.tint)
        } else {
          Text(icon)
        }
      } else {
        Circle().fill(space.tint).frame(width: size * 0.6, height: size * 0.6)
      }
    }
    .font(.system(size: size))
    .frame(width: size + 6, height: size + 6)
  }
}

struct Favicon: View {
  let url: URL?
  var size: CGFloat = 18

  var body: some View {
    Group {
      if let iconURL {
        AsyncImage(url: iconURL) { phase in
          if let image = phase.image {
            image.resizable().interpolation(.high).scaledToFit()
          } else {
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
  }

  private var iconURL: URL? {
    guard let url, let scheme = url.scheme, scheme.hasPrefix("http"), let host = url.host() else { return nil }
    return URL(string: "\(scheme)://\(host)/favicon.ico")
  }

  private var placeholder: some View {
    Image(systemName: "globe")
      .resizable()
      .scaledToFit()
      .foregroundStyle(.secondary)
      .padding(size * 0.08)
  }
}
