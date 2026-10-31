import SwiftUI

struct RootView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    @Bindable var browser = browser
    Group {
      if horizontalSizeClass == .regular {
        RegularBrowserView()
      } else {
        CompactBrowserView()
      }
    }
    .background {
      DisplayCornerReader { radius in
        if browser.morph.displayCornerRadius != radius { browser.morph.displayCornerRadius = radius }
      }
    }
    .onChange(of: browser.sync.client.spaces) { _, spaces in
      browser.reconcilePinTabs(with: spaces)
    }
    .onChange(of: horizontalSizeClass, initial: true) { _, sizeClass in
      browser.isCompactLayout = sizeClass != .regular
    }
    .sheet(isPresented: $browser.isShowingSettings) {
      SettingsView().environment(browser)
    }
    .sheet(isPresented: $browser.isShowingDevices) {
      DevicesView().environment(browser)
    }
    .sheet(isPresented: $browser.isShowingSyncSetup) {
      SyncSetupSheet().environment(browser)
    }
    .sheet(item: $browser.themeEditTarget) { target in
      NavigationStack {
        ThemeEditorView(target: target)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button("Done") { browser.themeEditTarget = nil }
            }
          }
      }
      .environment(browser)
    }
    .tint(browser.themes.accent(for: browser.currentTheme, dark: colorScheme == .dark))
  }
}

#Preview("Phone") {
  RootView()
    .environment(BrowserModel.preview())
}

#Preview("Tab Switcher") {
  let browser = BrowserModel.preview()
  browser.isShowingTabSwitcher = true
  return RootView().environment(browser)
}

#Preview("Devices") {
  DevicesView()
    .environment(BrowserModel.preview())
}
