import SwiftUI

struct BrowserCommands: Commands {
  let browser: BrowserModel

  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      Button("New Tab") { browser.beginNewTab() }
        .keyboardShortcut("t")
      Button("Reopen Closed Tab") { browser.reopenClosedTab() }
        .keyboardShortcut("t", modifiers: [.command, .shift])
      Button("Open Location") { browser.beginEditingCurrent() }
        .keyboardShortcut("l")
      Button("Close Tab") { browser.closeSelectedTab() }
        .keyboardShortcut("w")
    }
    CommandGroup(after: .textEditing) {
      Button("Find on Page") { browser.findInPage() }
        .keyboardShortcut("f")
    }
    CommandMenu("Navigate") {
      Button("Reload Page") { browser.reload() }
        .keyboardShortcut("r")
      Button("Back") { browser.goBack() }
        .keyboardShortcut("[")
      Button("Forward") { browser.goForward() }
        .keyboardShortcut("]")
      Divider()
      Button("Next Tab") { browser.selectAdjacent(1, wrap: true) }
        .keyboardShortcut(.tab, modifiers: .control)
      Button("Previous Tab") { browser.selectAdjacent(-1, wrap: true) }
        .keyboardShortcut(.tab, modifiers: [.control, .shift])
      Button("Show All Tabs") { browser.showTabSwitcher() }
        .keyboardShortcut("\\", modifiers: [.command, .shift])
    }
    CommandGroup(after: .sidebar) {
      Button("Toggle Sidebar") {
        withAnimation(.snappy) { browser.isSidebarVisible.toggle() }
      }
      .keyboardShortcut("s", modifiers: [.command])
      Button("Share Page") { browser.sharePage() }
        .keyboardShortcut("i", modifiers: [.command, .shift])
    }
  }
}
