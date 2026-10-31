import SwiftUI

struct RegularBrowserView: View {
  @Environment(BrowserModel.self) private var browser

  private let barHeight: CGFloat = 46

  var body: some View {
    ZStack {
      OrbitBackdrop(tint: browser.currentSpace?.tint)
        .ignoresSafeArea()
      HStack(spacing: 0) {
        if browser.isSidebarVisible {
          SidebarView()
            .frame(width: 290)
            .transition(.move(edge: .leading).combined(with: .opacity))
        }
        contentColumn
      }
      .animation(.snappy(duration: 0.3), value: browser.isSidebarVisible)
      if browser.isShowingTabSwitcher {
        TabSwitcherView()
          .ignoresSafeArea(.keyboard)
          .transition(.opacity)
          .zIndex(1)
      }
    }
  }

  private var contentColumn: some View {
    ZStack(alignment: .bottom) {
      ZStack(alignment: .bottom) {
        BrowserContent(bottomObscured: browser.chromeCollapsed ? 40 : barHeight + 22)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          .shadow(color: .black.opacity(0.22), radius: 10, y: 3)
        RegularBottomBar(barHeight: barHeight)
          .padding(.horizontal, 14)
          .padding(.bottom, 10)
      }
      .ignoresSafeArea(.keyboard)
      if browser.entry.isPresented {
        AddressEntryOverlay(layout: .regular)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          .transition(.opacity.combined(with: .move(edge: .bottom)))
          .zIndex(2)
      }
    }
    .padding(.top, 6)
    .padding(.bottom, 8)
    .padding(.trailing, 8)
    .padding(.leading, browser.isSidebarVisible ? 0 : 8)
  }
}

struct RegularBottomBar: View {
  @Environment(BrowserModel.self) private var browser
  let barHeight: CGFloat

  var body: some View {
    Group {
      if browser.chromeCollapsed {
        CollapsedAddressLabel()
          .frame(maxWidth: .infinity)
          .transition(.opacity)
      } else {
        GlassEffectContainer(spacing: 10) {
          HStack(spacing: 10) {
            if !browser.isSidebarVisible {
              GlassCircleButton(systemImage: "sidebar.left", label: "Show Sidebar", size: barHeight) {
                browser.isSidebarVisible = true
              }
            }
            Spacer(minLength: 0)
            URLCapsule(height: barHeight)
              .frame(maxWidth: 560)
            Spacer(minLength: 0)
            GlassCircleButton(systemImage: "plus", label: "New Tab", size: barHeight) {
              browser.beginNewTab()
            }
          }
        }
        .transition(.opacity.combined(with: .offset(y: 16)))
      }
    }
    .opacity(browser.entry.isPresented ? 0 : 1)
  }
}
