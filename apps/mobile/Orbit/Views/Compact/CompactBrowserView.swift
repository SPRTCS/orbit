import SwiftUI

struct CompactBrowserView: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    ZStack(alignment: .bottom) {
      GeometryReader { proxy in
        let metrics = ChromeMetrics.compact(
          safeBottom: proxy.safeAreaInsets.bottom, width: proxy.size.width,
          displayCornerRadius: browser.morph.displayCornerRadius, safeLeading: proxy.safeAreaInsets.leading,
          safeTrailing: proxy.safeAreaInsets.trailing)
        ZStack(alignment: .bottom) {
          BrowserContent(bottomObscured: metrics.obscured(collapsed: browser.chromeCollapsed))
            .reportsGlobalFrame { frame in
              browser.morph.pageFrame = frame
              browser.morph.pageCornerRadius = browser.morph.displayCornerRadius
            }
          BottomChrome(style: .compact, metrics: metrics)
        }
        .ignoresSafeArea(.container)
      }
      .ignoresSafeArea(.keyboard)

      if browser.isShowingTabSwitcher {
        TabSwitcherView()
          .ignoresSafeArea(.keyboard)
          .transition(.opacity.combined(with: .scale(scale: 1.04)))
          .zIndex(1)
      }

      OverviewMorphLayer()
        .zIndex(1.5)

      if browser.entry.isPresented {
        AddressEntryOverlay(layout: .compact)
          .transition(.opacity.combined(with: .move(edge: .bottom)))
          .zIndex(2)
      }
    }
    .background(OrbitBackdrop().ignoresSafeArea())
  }
}
