import SwiftUI

@MainActor
@Observable
final class PrivateTabPress {
  static let holdDuration: Duration = .milliseconds(380)

  private(set) var isArmed = false
  @ObservationIgnored private var hold: Task<Void, Never>?

  func pressChanged(_ isPressed: Bool) {
    hold?.cancel()
    if isPressed {
      isArmed = false
      hold = Task { [weak self] in
        try? await Task.sleep(for: Self.holdDuration)
        guard !Task.isCancelled else { return }
        withAnimation(.snappy(duration: 0.18)) { self?.isArmed = true }
      }
    } else {
      hold = nil
      Task { [weak self] in
        try? await Task.sleep(for: .milliseconds(250))
        guard let self, self.hold == nil else { return }
        withAnimation(.snappy(duration: 0.2)) { self.isArmed = false }
      }
    }
  }

  func open(in browser: BrowserModel) {
    browser.beginNewTab(isPrivate: isArmed)
  }
}

struct PrivateTabPressStyle: ButtonStyle {
  let press: PrivateTabPress

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .onChange(of: configuration.isPressed) { _, isPressed in press.pressChanged(isPressed) }
  }
}

struct NewTabButton: View {
  @Environment(BrowserModel.self) private var browser
  var size: CGFloat = 50
  var glassID: String?
  var glassNamespace: Namespace.ID?
  @State private var press = PrivateTabPress()

  var body: some View {
    Button {
      press.open(in: browser)
    } label: {
      Image(systemName: "plus")
        .font(.system(size: size * 0.38, weight: .semibold))
        .foregroundStyle(press.isArmed ? Color.white : Color.primary)
        .frame(width: size, height: size)
        .background(Circle().fill(Color.privateTabFill).opacity(press.isArmed ? 1 : 0))
        .contentShape(.circle)
    }
    .buttonStyle(PrivateTabPressStyle(press: press))
    .glassEffect(press.isArmed ? .identity : .regular, in: .circle)
    .glassID(glassID ?? "plus", in: glassNamespace)
    .hoverEffect(.lift)
    .sensoryFeedback(.impact(weight: .medium), trigger: press.isArmed) { _, isArmed in isArmed }
    .accessibilityLabel(press.isArmed ? "New Private Tab" : "New Tab")
    .accessibilityHint("Touch and hold to open a private tab.")
    .accessibilityAction(named: "New Private Tab") { browser.beginNewTab(isPrivate: true) }
  }
}

struct NewTabRow: View {
  @Environment(BrowserModel.self) private var browser
  @State private var press = PrivateTabPress()

  var body: some View {
    Button {
      press.open(in: browser)
    } label: {
      Label(
        press.isArmed ? "New Private Tab" : "New Tab", systemImage: press.isArmed ? "hand.raised.fill" : "plus"
      )
      .font(.system(size: 14, weight: .medium))
      .foregroundStyle(press.isArmed ? AnyShapeStyle(Color.white) : AnyShapeStyle(.secondary))
      .padding(.horizontal, 8)
      .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
      .background {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(Color.privateTabFill)
          .opacity(press.isArmed ? 1 : 0)
      }
      .contentShape(.rect)
    }
    .buttonStyle(PrivateTabPressStyle(press: press))
    .hoverEffect(.highlight)
    .sensoryFeedback(.impact(weight: .medium), trigger: press.isArmed) { _, isArmed in isArmed }
    .accessibilityHint("Touch and hold to open a private tab.")
    .accessibilityAction(named: "New Private Tab") { browser.beginNewTab(isPrivate: true) }
  }
}

struct PinnedTabBadge: View {
  var size: CGFloat = 28

  var body: some View {
    Image(systemName: "pin.fill")
      .font(.system(size: size * 0.4, weight: .semibold))
      .frame(width: size, height: size)
      .glassEffect(.regular, in: .circle)
      .accessibilityLabel("Pinned")
  }
}

struct PrivateTabBadge: View {
  var size: CGFloat = 28

  var body: some View {
    Image(systemName: "hand.raised.fill")
      .font(.system(size: size * 0.43, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(Color.privateTabFill, in: .circle)
      .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
      .accessibilityLabel("Private")
  }
}
