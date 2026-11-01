import SwiftUI

@main
struct OrbitApp: App {
  @UIApplicationDelegateAdaptor(OrbitAppDelegate.self) private var appDelegate
  @State private var browser = makeBrowser()
  @State private var quickActions = QuickActionInbox.shared
  @Environment(\.scenePhase) private var scenePhase

  private static func makeBrowser() -> BrowserModel {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-OrbitDemo") { return StoreDemo.makeBrowser() }
    #endif
    return BrowserModel()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(browser)
        .preferredColorScheme(browser.themes.colorScheme)
        .onOpenURL { url in browser.openIncoming(url) }
        .onChange(of: quickActions.pending, initial: true) { _, action in
          guard let action else { return }
          quickActions.pending = nil
          browser.perform(action)
        }
    }
    .commands { BrowserCommands(browser: browser) }
    .onChange(of: scenePhase, initial: true) { _, phase in
      browser.scenePhaseChanged(phase)
    }
  }
}

extension BrowserModel {
  static func preview() -> BrowserModel {
    let directory = FileManager.default.temporaryDirectory.appending(path: "OrbitPreview-\(UUID().uuidString)")
    let browser = BrowserModel(
      persistence: TabPersistence(directory: directory), settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitPreview")!),
      syncClient: PreviewSync(populated: true))
    browser.entry.dismiss()
    return browser
  }
}
