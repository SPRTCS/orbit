#if DEBUG
import Foundation
import OrbitSync

@MainActor
enum StoreDemo {
  static func makeBrowser() -> BrowserModel {
    let client = PreviewSync(populated: true)
    client.thisDeviceName = "iPhone"
    let reading = SyncedFolder(id: "reading", name: "Weekend reading", path: ["Weekend reading"], parentId: nil, emoji: "📚", color: "blue")
    let travel = SyncedFolder(id: "travel", name: "Next adventure", path: ["Next adventure"], parentId: nil, emoji: "🏔️", color: "green")
    client.spaces = [
      SyncedSpace(id: "discover", name: "Discover", color: "#8B7CF6", icon: "🪐", isDefault: true, pins: [
        pin("nasa", "NASA", "https://www.nasa.gov", tile: true),
        pin("wiki", "Wikipedia", "https://www.wikipedia.org", tile: true),
        pin("unsplash", "Unsplash", "https://unsplash.com", tile: true),
        pin("apple", "Apple", "https://www.apple.com", tile: true),
        pin("mdn", "MDN", "https://developer.mozilla.org", tile: true),
        pin("swift", "Swift", "https://www.swift.org", tile: true),
        pin("solar", "Our solar system", "https://science.nasa.gov/solar-system/", folder: reading),
        pin("earth", "The blue marble", "https://science.nasa.gov/earth/", folder: reading),
        pin("parks", "National parks", "https://www.nps.gov", folder: travel),
        pin("iceland", "Iceland", "https://en.wikipedia.org/wiki/Iceland", folder: travel),
      ], folders: [reading, travel]),
      SyncedSpace(id: "create", name: "Create", color: "#3EB489", icon: "🎨", isDefault: false, pins: [
        pin("github", "GitHub", "https://github.com", tile: true),
        pin("figma", "Figma", "https://www.figma.com", tile: true),
        pin("developer", "Developer", "https://developer.apple.com", tile: true),
      ]),
      SyncedSpace(id: "explore", name: "Explore", color: "#E3AC38", icon: "🌍", isDefault: false, pins: [])
    ]
    client.devices = [SyncedDevice(id: "demo-mac", name: "MacBook Air", spaceId: "discover", tabs: [
      SyncedTab(url: URL(string: "https://science.nasa.gov/solar-system/")!, title: "Explore the solar system"),
      SyncedTab(url: URL(string: "https://www.nps.gov")!, title: "Find your next adventure"),
      SyncedTab(url: URL(string: "https://www.swift.org")!, title: "A language for creating")
    ], updatedAt: .now, deviceId: "demo-mac")]
    let directory = FileManager.default.temporaryDirectory.appending(path: "OrbitStoreDemo-\(UUID().uuidString)")
    let defaults = UserDefaults(suiteName: "OrbitStoreDemo")!
    defaults.removePersistentDomain(forName: "OrbitStoreDemo")
    let browser = BrowserModel(persistence: TabPersistence(directory: directory), settings: AppSettings(defaults: defaults), syncClient: client)
    browser.settings.searchSuggestionsEnabled = false
    browser.themes.appearance = .light
    for (title, address) in [
      ("Our solar system", "https://science.nasa.gov/solar-system/"),
      ("Swift", "https://www.swift.org"),
      ("Iceland", "https://en.wikipedia.org/wiki/Iceland"),
      ("NASA", "https://www.nasa.gov")
    ] {
      let tab = browser.openNewTab(with: URL(string: address)!)
      tab.title = title
    }
    browser.entry.dismiss()
    return browser
  }

  private static func pin(_ id: String, _ title: String, _ address: String, tile: Bool = false, folder: SyncedFolder? = nil) -> SyncedPin {
    SyncedPin(id: id, title: title, url: URL(string: address)!, groupId: nil, folderPath: folder?.path ?? [], isTile: tile, folderId: folder?.id)
  }
}
#endif
