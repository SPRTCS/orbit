import SwiftUI
import UIKit

struct PageMenuItem: Identifiable {
  let id: String
  let title: String
  let systemImage: String
  var isEnabled = true
  var isDestructive = false
  var children: [PageMenuItem] = []
  var action: () -> Void = {}
}

enum PageMenu {
  static func sections(for browser: BrowserModel) -> [[PageMenuItem]] {
    let tab = browser.selectedTab
    let hasPage = tab?.url != nil
    var sections: [[PageMenuItem]] = []
    sections.append([
      PageMenuItem(id: "share", title: String(localized: "Share"), systemImage: "square.and.arrow.up", isEnabled: hasPage) {
        browser.sharePage()
      },
      PageMenuItem(
        id: "find", title: String(localized: "Find on Page"), systemImage: "doc.text.magnifyingglass",
        isEnabled: tab?.webView != nil
      ) { browser.findInPage() },
      PageMenuItem(id: "reader", title: String(localized: "Open in Reader"), systemImage: "doc.plaintext", isEnabled: hasPage) {
        browser.openReader()
      },
      PageMenuItem(id: "copy", title: String(localized: "Copy Link"), systemImage: "link", isEnabled: hasPage) {
        browser.copyLink()
      },
    ])
    var site: [PageMenuItem] = []
    if let mode = browser.selectedSiteMode {
      site.append(
        PageMenuItem(
          id: "mode",
          title: mode == .desktop ? String(localized: "Request Mobile Website") : String(localized: "Request Desktop Website"),
          systemImage: mode == .desktop ? "iphone" : "desktopcomputer"
        ) { browser.toggleSiteMode() })
    }
    site.append(
      PageMenuItem(
        id: "zoom", title: String(localized: "Page Zoom: \(PageZoom.label(browser.selectedPageZoom))"),
        systemImage: "textformat.size", isEnabled: hasPage,
        children: [
          PageMenuItem(id: "zoom-in", title: String(localized: "Zoom In"), systemImage: "plus.magnifyingglass") {
            browser.zoomPage(by: 1)
          },
          PageMenuItem(id: "zoom-reset", title: String(localized: "Actual Size"), systemImage: "1.magnifyingglass") {
            browser.setPageZoom(1)
          },
          PageMenuItem(id: "zoom-out", title: String(localized: "Zoom Out"), systemImage: "minus.magnifyingglass") {
            browser.zoomPage(by: -1)
          },
        ]))
    sections.append(site)
    sections.append([
      PageMenuItem(id: "history", title: String(localized: "History"), systemImage: "clock") {
        browser.isShowingHistory = true
      },
      PageMenuItem(id: "downloads", title: String(localized: "Downloads"), systemImage: "arrow.down.circle") {
        browser.isShowingDownloads = true
      },
      PageMenuItem(
        id: "reopen", title: String(localized: "Reopen Closed Tab"), systemImage: "arrow.uturn.backward.square",
        isEnabled: browser.canReopenClosedTab
      ) { browser.reopenClosedTab() },
    ])
    if tab?.isPinTab == true {
      sections.append([
        PageMenuItem(id: "pin-home", title: String(localized: "Back to Pinned URL"), systemImage: "arrow.uturn.backward") {
          browser.returnSelectedPinToHome()
        }
      ])
    }
    sections.append([
      PageMenuItem(
        id: "back", title: String(localized: "Back"), systemImage: "chevron.backward", isEnabled: tab?.canGoBack == true
      ) { browser.goBack() },
      PageMenuItem(
        id: "forward", title: String(localized: "Forward"), systemImage: "chevron.forward",
        isEnabled: tab?.canGoForward == true
      ) { browser.goForward() },
      PageMenuItem(id: "reload", title: String(localized: "Reload"), systemImage: "arrow.clockwise", isEnabled: hasPage) {
        browser.reload()
      },
    ])
    sections.append([
      PageMenuItem(
        id: "close", title: String(localized: "Close Tab"), systemImage: "xmark", isEnabled: tab != nil, isDestructive: true
      ) { browser.closeSelectedTab() }
    ])
    return sections
  }

  static func elements(_ sections: [[PageMenuItem]]) -> [UIMenuElement] {
    sections.map { UIMenu(options: .displayInline, children: $0.map(element)) }
  }

  private static func element(_ item: PageMenuItem) -> UIMenuElement {
    let image = UIImage(systemName: item.systemImage)
    if !item.children.isEmpty {
      let menu = UIMenu(title: item.title, image: image, children: item.children.map(element))
      return item.isEnabled ? menu : UIAction(title: item.title, image: image, attributes: .disabled) { _ in }
    }
    var attributes: UIMenuElement.Attributes = []
    if !item.isEnabled { attributes.insert(.disabled) }
    if item.isDestructive { attributes.insert(.destructive) }
    let action = item.action
    return UIAction(title: item.title, image: image, attributes: attributes) { _ in action() }
  }
}

struct PageActionsMenu: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    ForEach(Array(PageMenu.sections(for: browser).enumerated()), id: \.offset) { _, items in
      Section {
        ForEach(items) { PageMenuRow(item: $0) }
      }
    }
  }
}

struct PageMenuRow: View {
  let item: PageMenuItem

  var body: some View {
    if item.children.isEmpty {
      Button(item.title, systemImage: item.systemImage, role: item.isDestructive ? .destructive : nil, action: item.action)
        .disabled(!item.isEnabled)
    } else {
      Menu(item.title, systemImage: item.systemImage) {
        ForEach(item.children) { child in
          Button(child.title, systemImage: child.systemImage, action: child.action)
        }
      }
      .disabled(!item.isEnabled)
    }
  }
}

struct PageMenuButton: UIViewRepresentable {
  let browser: BrowserModel
  let isPrivate: Bool

  func makeUIView(context: Context) -> UIButton {
    let button = UIButton(type: .system)
    button.showsMenuAsPrimaryAction = true
    button.menu = UIMenu(children: [
      UIDeferredMenuElement.uncached { [weak browser] completion in
        completion(browser.map { PageMenu.elements(PageMenu.sections(for: $0)) } ?? [])
      }
    ])
    button.preferredMenuElementOrder = .fixed
    style(button)
    return button
  }

  func updateUIView(_ button: UIButton, context: Context) {
    style(button)
  }

  private func style(_ button: UIButton) {
    let symbol = UIImage.SymbolConfiguration(pointSize: isPrivate ? 13 : 15, weight: .semibold)
    button.setImage(UIImage(systemName: isPrivate ? "hand.raised.fill" : "ellipsis", withConfiguration: symbol), for: .normal)
    button.tintColor = isPrivate ? UIColor(Color.privateTab) : .secondaryLabel
  }
}
