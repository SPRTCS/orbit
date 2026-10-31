import SwiftUI

struct CompactBrowserView: View {
  @Environment(BrowserModel.self) private var browser

  private let barHeight: CGFloat = 50
  private let collapsedHeight: CGFloat = 28

  var body: some View {
    ZStack(alignment: .bottom) {
      GeometryReader { proxy in
        let safeBottom = proxy.safeAreaInsets.bottom
        let safeTop = proxy.safeAreaInsets.top
        ZStack(alignment: .bottom) {
          BrowserContent(bottomObscured: safeBottom + (browser.chromeCollapsed ? collapsedHeight + 4 : barHeight + 10))
            .ignoresSafeArea()
          StatusBarBacking(height: safeTop)
            .frame(maxHeight: .infinity, alignment: .top)
            .ignoresSafeArea()
          CompactBottomBar(barHeight: barHeight)
            .padding(.horizontal, 14)
            .padding(.bottom, safeBottom > 0 ? 2 : 10)
        }
      }
      .ignoresSafeArea(.keyboard)

      if browser.isShowingTabSwitcher {
        TabSwitcherView()
          .ignoresSafeArea(.keyboard)
          .transition(.opacity.combined(with: .scale(scale: 1.04)))
          .zIndex(1)
      }

      if browser.entry.isPresented {
        AddressEntryOverlay(layout: .compact)
          .transition(.opacity.combined(with: .move(edge: .bottom)))
          .zIndex(2)
      }
    }
    .background(OrbitBackdrop().ignoresSafeArea())
  }
}

struct StatusBarBacking: View {
  @Environment(BrowserModel.self) private var browser
  let height: CGFloat

  var body: some View {
    Group {
      if let tab = browser.selectedTab, !tab.isBlank {
        if let color = tab.themeColor {
          Rectangle().fill(Color(uiColor: color))
        } else {
          Rectangle().fill(.bar)
        }
      } else {
        Color.clear
      }
    }
    .frame(height: height)
    .allowsHitTesting(false)
  }
}

struct CompactBottomBar: View {
  @Environment(BrowserModel.self) private var browser
  let barHeight: CGFloat

  var body: some View {
    Group {
      if browser.chromeCollapsed {
        CollapsedAddressLabel()
          .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottom)))
      } else {
        GlassEffectContainer(spacing: 10) {
          HStack(spacing: 10) {
            TabStackButton(size: barHeight)
            URLCapsule(height: barHeight)
            GlassCircleButton(systemImage: "plus", label: "New Tab", size: barHeight) {
              browser.beginNewTab()
            }
          }
        }
        .transition(.opacity.combined(with: .offset(y: 20)))
      }
    }
    .opacity(browser.entry.isPresented ? 0 : 1)
  }
}
