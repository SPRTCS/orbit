import SwiftUI

struct ChromeMetrics {
  let barHeight: CGFloat
  let barBottomPadding: CGFloat
  let pillBottomPadding: CGFloat
  let pillWidth: CGFloat
  var horizontalPadding: CGFloat = 14

  static let maximumDisplayCornerRadius: CGFloat = 64

  static func displayCornerRadius(isPad: Bool, safeBottom: CGFloat) -> CGFloat {
    guard safeBottom > 0 else { return 0 }
    return isPad ? 18 : 55
  }

  static let minimumEdgeGap: CGFloat = 20

  static func edgeGap(displayCornerRadius: CGFloat, controlSize: CGFloat, safeBottom: CGFloat) -> CGFloat {
    guard safeBottom > 0 else { return minimumEdgeGap }
    let radius = min(max(displayCornerRadius, 0), maximumDisplayCornerRadius)
    let homeIndicatorClearance = min(safeBottom, 40) + 2
    return max(radius - controlSize / 2, homeIndicatorClearance, minimumEdgeGap)
  }

  static func horizontalInset(edgeGap: CGFloat, safeLeading: CGFloat, safeTrailing: CGFloat) -> CGFloat {
    max(edgeGap, min(safeLeading, safeTrailing))
  }

  var expandedObscured: CGFloat { barBottomPadding + barHeight + 8 }
  var collapsedObscured: CGFloat { pillBottomPadding + MinimizedAddressPill.height + 6 }

  func bottomPadding(collapsed: Bool) -> CGFloat {
    collapsed ? pillBottomPadding : barBottomPadding
  }

  func obscured(collapsed: Bool) -> CGFloat {
    collapsed ? collapsedObscured : expandedObscured
  }

  static func compact(
    safeBottom: CGFloat, width: CGFloat, displayCornerRadius: CGFloat = 0, safeLeading: CGFloat = 0,
    safeTrailing: CGFloat = 0
  ) -> ChromeMetrics {
    let barHeight: CGFloat = 50
    let gap = edgeGap(displayCornerRadius: displayCornerRadius, controlSize: barHeight, safeBottom: safeBottom)
    let hasHomeIndicator = safeBottom > 0
    return ChromeMetrics(
      barHeight: barHeight,
      barBottomPadding: hasHomeIndicator ? gap : 10,
      pillBottomPadding: hasHomeIndicator ? max(18, safeBottom - 14) : 6,
      pillWidth: min(max(width * 0.45, 150), 300),
      horizontalPadding: hasHomeIndicator
        ? horizontalInset(edgeGap: gap, safeLeading: safeLeading, safeTrailing: safeTrailing) : 14)
  }

  static let regularControlSize: CGFloat = 46

  static func regular(edgeGap: CGFloat, cardInset: CGFloat, safeBottom: CGFloat, width: CGFloat) -> ChromeMetrics {
    ChromeMetrics(
      barHeight: regularControlSize,
      barBottomPadding: max(edgeGap - cardInset, 6),
      pillBottomPadding: max(6, safeBottom - cardInset - 6),
      pillWidth: min(max(width * 0.32, 180), 320),
      horizontalPadding: max(edgeGap - cardInset, 6))
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
        .modifier(OverviewSwipeModifier(gesture: overviewSwipe))
      }
    }
    .padding(.horizontal, metrics.horizontalPadding)
    .padding(.bottom, metrics.bottomPadding(collapsed: browser.chromeCollapsed))
    .opacity(browser.entry.isPresented ? 0 : 1)
  }

  private var overviewSwipe: VerticalSwipeGesture {
    VerticalSwipeGesture(
      onBegan: { browser.beginInteractiveOverview() },
      onChanged: { translation in
        browser.updateInteractiveOverview(
          OverviewMorph.swipeProgress(translation: translation), translation: CGSize(width: 0, height: min(0, translation) * 0.15))
      },
      onEnded: { translation, velocity in
        browser.endInteractiveOverview(
          commit: OverviewMorph.shouldCommit(
            progress: OverviewMorph.swipeProgress(translation: translation), velocity: -velocity / 1000))
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
