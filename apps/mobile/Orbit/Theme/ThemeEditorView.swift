import OrbitSync
import SwiftUI

struct ThemeEditTarget: Identifiable, Hashable {
  let space: SyncedSpace?

  var id: String { space?.id ?? ThemeStore.localSpaceID }
  var title: String { space?.name ?? "This Device" }
}

struct ThemeEditorView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.colorScheme) private var colorScheme
  let target: ThemeEditTarget
  @State private var selectedStop = 0

  private var store: ThemeStore { browser.themes }
  private var theme: ProfileTheme { store.theme(for: target.space) }
  private var editsDarkLook: Bool { theme.dark != nil && theme.isDark(appDark: colorScheme == .dark) }
  private var look: ThemeLook { editsDarkLook ? (theme.dark ?? theme.look) : theme.look }

  var body: some View {
    Form {
      Section {
        ThemePreview(theme: theme)
          .frame(height: 96)
          .listRowInsets(EdgeInsets())
      }

      Section("Colour") {
        ScrollView(.horizontal) {
          HStack(spacing: 10) {
            ForEach(ProfileColor.allCases) { preset in
              Button {
                store.setTheme(ThemeMath.glassTheme(for: preset), for: target.space)
              } label: {
                Circle()
                  .fill(Color(theme: ThemeMath.hexColor(preset.swatch)))
                  .frame(width: 28, height: 28)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(preset.name)
            }
            Button {
              store.setTheme(ThemeMath.startingTheme(swatch: ProfileColor.purple.swatch), for: target.space)
            } label: {
              Circle()
                .fill(AngularGradient(colors: [.pink, .orange, .yellow, .green, .blue, .purple, .pink], center: .center))
                .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Custom Gradient")
          }
          .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
      }

      Section {
        HStack {
          Spacer()
          ThemeColorPad(look: look, selected: $selectedStop) { next in update(next) }
            .frame(width: 220, height: 220)
          Spacer()
        }
        HStack {
          Text("\(look.stops.count) of \(ThemeMath.maxStops) colours")
            .foregroundStyle(.secondary)
          Spacer()
          Button("Remove Colour", systemImage: "minus") {
            update(ThemeMath.withoutStop(look, at: min(selectedStop, look.stops.count - 1)))
            selectedStop = max(0, selectedStop - 1)
          }
          .labelStyle(.iconOnly)
          .disabled(look.stops.count <= 1)
          Button("Add Colour", systemImage: "plus") {
            update(ThemeMath.withAddedStop(look))
            selectedStop = look.stops.count
          }
          .labelStyle(.iconOnly)
          .disabled(look.stops.count >= ThemeMath.maxStops)
        }
        .buttonStyle(.bordered)
        if look.stops.indices.contains(selectedStop) {
          ColorPicker(
            "Selected Colour",
            selection: Binding(
              get: { Color(theme: look.stops[selectedStop].color) },
              set: { update(ThemeMath.withColor(look, at: selectedStop, color: $0.themeColor)) }),
            supportsOpacity: false)
        }
      } header: {
        Text("Gradient")
      } footer: {
        Text("Drag the colours on the pad. Tap one to select it.")
      }

      Section("Look") {
        LabeledSlider(title: "Intensity", value: look.intensity) { value in
          var next = look
          next.intensity = value
          update(next)
        }
        LabeledSlider(title: "Pass-through blur", value: look.translucency) { value in
          var next = look
          next.translucency = value
          update(next)
        }
        LabeledSlider(title: "Noise", value: look.grain) { value in
          var next = look
          next.grain = value
          update(next)
        }
        Picker("Texture", selection: Binding(get: { look.texture }, set: { texture in
          var next = look
          next.texture = texture
          if next.grain == 0 { next.grain = 0.5 }
          update(next)
        })) {
          ForEach(ThemeTexture.allCases) { texture in Text(texture.name).tag(texture) }
        }
      }

      Section {
        Picker("Appearance", selection: Binding(get: { theme.mode }, set: { mode in
          var next = theme
          next.mode = mode
          store.setTheme(next, for: target.space)
        })) {
          ForEach(ThemeMode.allCases) { mode in Label(mode.title, systemImage: mode.symbol).tag(mode) }
        }
        .pickerStyle(.segmented)
        Toggle("Separate Dark Look", isOn: Binding(get: { theme.dark != nil }, set: { separate in
          var next = theme
          next.dark = separate ? (ThemeMath.glassTheme(for: .plum).dark ?? theme.look) : nil
          store.setTheme(next, for: target.space)
        }))
      } footer: {
        Text(theme.dark != nil
          ? "Editing the \(editsDarkLook ? "dark" : "light") look. Switch the system appearance to edit the other one."
          : "One look for light and dark.")
      }

      Section {
        Button(target.space == nil ? "Reset to Default" : "Use Mac’s Theme", role: .destructive) {
          store.resetTheme(for: target.space)
        }
        .disabled(!store.hasOverride(for: target.space))
      } footer: {
        Text("Changes stay on this device.")
      }
    }
    .navigationTitle("\(target.title) Theme")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func update(_ next: ThemeLook) {
    var updated = theme
    if editsDarkLook { updated.dark = next } else { updated.look = next }
    store.setTheme(updated, for: target.space)
  }
}

struct ThemePreview: View {
  let theme: ProfileTheme
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let dark = theme.isDark(appDark: colorScheme == .dark)
    ZStack(alignment: .leading) {
      ThemeBackdrop(theme: theme)
      VStack(alignment: .leading, spacing: 6) {
        ForEach([1.0, 0.7, 0.85], id: \.self) { width in
          Capsule()
            .fill(dark ? Color.white.opacity(0.35) : Color.black.opacity(0.18))
            .frame(width: 60 * width, height: 6)
        }
      }
      .padding(.leading, 14)
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(dark ? Color(white: 0.07, opacity: 0.72) : Color.white.opacity(0.82))
        .padding(.leading, 96)
        .padding(10)
    }
    .environment(\.colorScheme, dark ? .dark : .light)
  }
}

struct LabeledSlider: View {
  let title: String
  let value: Double
  let onChange: (Double) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(title)
        Spacer()
        Text("\(Int((value * 100).rounded()))%").foregroundStyle(.secondary).monospacedDigit()
      }
      Slider(value: Binding(get: { value }, set: { onChange($0) }), in: 0...1)
    }
  }
}

struct ThemeColorPad: View {
  let look: ThemeLook
  @Binding var selected: Int
  let onChange: (ThemeLook) -> Void
  @State private var draggingIndex: Int?

  private static let knob: CGFloat = 26

  var body: some View {
    GeometryReader { proxy in
      let side = min(proxy.size.width, proxy.size.height)
      ZStack {
        Circle()
          .fill(AngularGradient(colors: Self.hueRing, center: .center))
          .overlay {
            Circle().fill(
              RadialGradient(
                colors: [Color(white: ThemeMath.padLightness), Color(white: ThemeMath.padLightness).opacity(0)],
                center: .center, startRadius: 0, endRadius: side / 2))
          }
        ForEach(Array(look.stops.enumerated()), id: \.offset) { index, stop in
          Circle()
            .fill(Color(theme: stop.color))
            .frame(width: Self.knob, height: Self.knob)
            .overlay(Circle().strokeBorder(.white, lineWidth: index == selected ? 3 : 2))
            .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
            .position(x: CGFloat(stop.x) * side, y: CGFloat(stop.y) * side)
            .accessibilityLabel("Colour \(index + 1)")
            .accessibilityAddTraits(index == selected ? .isSelected : [])
        }
      }
      .frame(width: side, height: side)
      .contentShape(Circle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in
            let point = Self.insideCircle(x: Double(value.location.x / side), y: Double(value.location.y / side))
            if draggingIndex == nil {
              let start = (x: Double(value.startLocation.x / side), y: Double(value.startLocation.y / side))
              draggingIndex = Self.nearest(look.stops, to: start)
              if let draggingIndex { selected = draggingIndex }
            }
            guard let index = draggingIndex else { return }
            onChange(ThemeMath.withStop(look, at: index, x: point.x, y: point.y))
          }
          .onEnded { _ in draggingIndex = nil }
      )
    }
    .aspectRatio(1, contentMode: .fit)
  }

  private static let hueRing: [Color] = stride(from: 0.0, through: 1.0, by: 1.0 / 12).map { hue in
    Color(rgb: ThemeMath.hslToRgb(hue, 1, ThemeMath.padLightness))
  }

  static func nearest(_ stops: [ThemeStop], to point: (x: Double, y: Double)) -> Int? {
    stops.indices.min { hypot(stops[$0].x - point.x, stops[$0].y - point.y) < hypot(stops[$1].x - point.x, stops[$1].y - point.y) }
  }

  static func insideCircle(x: Double, y: Double) -> (x: Double, y: Double) {
    let dx = x - 0.5
    let dy = y - 0.5
    let r = hypot(dx, dy)
    return r <= 0.5 ? (x, y) : (0.5 + dx / r * 0.5, 0.5 + dy / r * 0.5)
  }
}

struct AppIconPickerView: View {
  struct Choice: Identifiable {
    let id: String
    let name: String
    var iconName: String? { id == "default" ? nil : "AppIcon-\(name)" }
  }

  static let choices = ["Default", "Midnight", "Daylight", "Plum", "Ocean", "Mono", "Noir"].map {
    Choice(id: $0.lowercased(), name: $0)
  }

  @State private var current = UIApplication.shared.alternateIconName
  @State private var errorMessage: String?

  var body: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 18)], spacing: 22) {
        ForEach(Self.choices) { choice in
          Button {
            select(choice)
          } label: {
            VStack(spacing: 8) {
              Image("IconPreview-\(choice.id)")
                .resizable()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                  RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(current == choice.iconName ? Color.accentColor : Color.primary.opacity(0.12),
                      lineWidth: current == choice.iconName ? 3 : 1)
                }
              Text(choice.name).font(.footnote.weight(.medium))
            }
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(current == choice.iconName ? .isSelected : [])
        }
      }
      .padding(20)
      if let errorMessage {
        Text(errorMessage).font(.footnote).foregroundStyle(.red).padding(.horizontal, 20)
      }
    }
    .navigationTitle("App Icon")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func select(_ choice: Choice) {
    guard UIApplication.shared.supportsAlternateIcons, current != choice.iconName else { return }
    errorMessage = nil
    UIApplication.shared.setAlternateIconName(choice.iconName) { error in
      Task { @MainActor in
        if let error {
          errorMessage = error.localizedDescription
        } else {
          current = choice.iconName
        }
      }
    }
  }
}
