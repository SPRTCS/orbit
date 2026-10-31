import SwiftUI

@main
struct OrbitApp: App {
  @State private var browser = makeBrowser()
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
