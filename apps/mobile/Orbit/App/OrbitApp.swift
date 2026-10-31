import SwiftUI

@main
struct OrbitApp: App {
  @State private var browser = BrowserModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(browser)
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
