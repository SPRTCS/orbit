import SwiftUI

struct ChromeMetrics {
  let barHeight: CGFloat
  let barBottomPadding: CGFloat
  let pillBottomPadding: CGFloat
  let pillWidth: CGFloat

  var expandedObscured: CGFloat { barBottomPadding + barHeight + 8 }
  var collapsedObscured: CGFloat { pillBottomPadding + MinimizedAddressPill.height + 6 }

  func bottomPadding(collapsed: Bool) -> CGFloat {
    collapsed ? pillBottomPadding : barBottomPadding
  }

  func obscured(collapsed: Bool) -> CGFloat {
    collapsed ? collapsedObscured : expandedObscured
  }

  static func compact(safeBottom: CGFloat, width: CGFloat) -> ChromeMetrics {
    let hasHomeIndicator = safeBottom > 0
    return ChromeMetrics(
      barHeight: 50,
      barBottomPadding: safeBottom + (hasHomeIndicator ? 2 : 10),
      pillBottomPadding: hasHomeIndicator ? max(18, safeBottom - 14) : 6,
      pillWidth: min(max(width * 0.45, 150), 300))
  }

  static func regular(homeIndicatorOverlap: CGFloat, width: CGFloat) -> ChromeMetrics {
    ChromeMetrics(
      barHeight: 46,
      barBottomPadding: homeIndicatorOverlap + 10,
      pillBottomPadding: max(6, homeIndicatorOverlap - 4),
      pillWidth: min(max(width * 0.32, 180), 320))
  }
}

struct BottomChrome: View {
  enum Style {
    case compact
    case regular
  }

  @Environment(BrowserModel.self) private var browser
  let style: Style
  let metrics: ChromeMetrics
  @Namespace private var glass

  var body: some View {
    GlassEffectContainer(spacing: 12) {
      if browser.chromeCollapsed {
        MinimizedAddressPill(width: metrics.pillWidth, glassNamespace: glass)
          .frame(maxWidth: .infinity)
      } else {
        HStack(spacing: 10) {
          leadingButton
          if style == .regular { Spacer(minLength: 0) }
          URLCapsule(height: metrics.barHeight, glassNamespace: glass)
            .frame(maxWidth: style == .regular ? 560 : .infinity)
          if style == .regular { Spacer(minLength: 0) }
          GlassCircleButton(
            systemImage: "plus", label: "New Tab", size: metrics.barHeight, glassID: "trailing", glassNamespace: glass
          ) {
            browser.beginNewTab()
          }
          .reportsGlobalFrame { browser.morph.plusFrame = $0 }
        }
        .modifier(OverviewSwipeModifier(gesture: style == .compact ? overviewSwipe : nil))
      }
    }
    .padding(.horizontal, 14)
    .padding(.bottom, metrics.bottomPadding(collapsed: browser.chromeCollapsed))
    .opacity(browser.entry.isPresented ? 0 : 1)
  }

  private var overviewSwipe: VerticalSwipeGesture {
    VerticalSwipeGesture(
      onBegan: { browser.beginInteractiveOverview() },
      onChanged: { translation in browser.updateInteractiveOverview(-translation / 320) },
      onEnded: { translation, velocity in
        browser.endInteractiveOverview(commit: -(translation + velocity * 0.2) > 140)
      })
  }

  @ViewBuilder
  private var leadingButton: some View {
    switch style {
    case .compact:
      TabStackButton(size: metrics.barHeight, glassNamespace: glass)
    case .regular:
      if browser.isSidebarVisible {
        Color.clear.frame(width: metrics.barHeight, height: metrics.barHeight)
      } else {
        GlassCircleButton(
          systemImage: "sidebar.left", label: "Show Sidebar", size: metrics.barHeight, glassID: "leading",
          glassNamespace: glass
        ) {
          withAnimation(.snappy(duration: 0.3)) { browser.isSidebarVisible = true }
        }
      }
    }
  }
}

struct OverviewSwipeModifier: ViewModifier {
  let gesture: VerticalSwipeGesture?

  func body(content: Content) -> some View {
    if let gesture {
      content.gesture(gesture)
    } else {
      content
    }
  }
}
