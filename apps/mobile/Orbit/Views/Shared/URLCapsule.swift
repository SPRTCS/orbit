import SwiftUI

struct URLCapsule: View {
  @Environment(BrowserModel.self) private var browser
  var height: CGFloat = 50
  @State private var dragOffset: CGFloat = 0

  var body: some View {
    let tab = browser.selectedTab
    HStack(spacing: 6) {
      Color.clear.frame(width: 30, height: 30)
      Spacer(minLength: 0)
      HStack(spacing: 5) {
        if let url = tab?.url, url.scheme == "http" {
          Image(systemName: "lock.open.fill")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.orange)
        }
        Text(label(for: tab))
          .font(.system(size: 16, weight: .medium))
          .foregroundStyle(tab?.url == nil ? .secondary : .primary)
          .lineLimit(1)
          .truncationMode(.middle)
      }
      Spacer(minLength: 0)
      Button {
        browser.reloadOrStop()
      } label: {
        Image(systemName: tab?.isLoading == true ? "xmark" : "arrow.clockwise")
          .font(.system(size: 14, weight: .semibold))
          .frame(width: 30, height: 30)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .opacity(tab?.url == nil ? 0 : 1)
      .disabled(tab?.url == nil)
      .accessibilityLabel(tab?.isLoading == true ? "Stop" : "Reload")
    }
    .padding(.horizontal, 10)
    .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
    .overlay(alignment: .bottom) {
      if let tab, tab.isLoading {
        GeometryReader { proxy in
          Capsule()
            .fill(Color.accentColor)
            .frame(width: max(8, proxy.size.width * tab.progress), height: 2.5)
            .animation(.easeOut(duration: 0.2), value: tab.progress)
        }
        .frame(height: 2.5)
        .padding(.horizontal, 18)
        .padding(.bottom, 3)
        .transition(.opacity)
      }
    }
    .contentShape(.capsule)
    .glassEffect(.regular.interactive(), in: .capsule)
    .offset(x: dragOffset)
    .onTapGesture { browser.beginEditingCurrent() }
    .gesture(
      HorizontalSwipeGesture(
        onChanged: { translation in
          dragOffset = translation * 0.45
        },
        onEnded: { translation, velocity in
          let projected = translation + velocity * 0.15
          if projected < -70 {
            if browser.hasNextTab { browser.selectAdjacent(1, wrap: false) } else { browser.beginNewTab() }
          } else if projected > 70 {
            browser.selectAdjacent(-1, wrap: false)
          }
          withAnimation(.spring(duration: 0.3, bounce: 0.25)) { dragOffset = 0 }
        })
    )
    .contextMenu { PageActionsMenu() }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Address")
    .accessibilityValue(label(for: tab))
    .accessibilityHint("Double-tap to search or enter an address. Swipe left or right to switch tabs.")
  }

  private func label(for tab: BrowserTab?) -> String {
    guard let tab, let url = tab.url else { return "Search or enter address" }
    if let query = SearchEngine.query(fromResultsPage: url) { return query }
    return Omnibox.displayHost(url)
  }
}

struct PageActionsMenu: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let tab = browser.selectedTab
    let hasPage = tab?.url != nil
    Section {
      Button("Share", systemImage: "square.and.arrow.up") { browser.sharePage() }
        .disabled(!hasPage)
      Button("Find on Page", systemImage: "doc.text.magnifyingglass") { browser.findInPage() }
        .disabled(tab?.webView == nil)
      Button("Open in Reader", systemImage: "doc.plaintext") { browser.openReader() }
        .disabled(!hasPage)
      Button("Copy Link", systemImage: "link") { browser.copyLink() }
        .disabled(!hasPage)
    }
    Section {
      Button("Back", systemImage: "chevron.backward") { browser.goBack() }
        .disabled(tab?.canGoBack != true)
      Button("Forward", systemImage: "chevron.forward") { browser.goForward() }
        .disabled(tab?.canGoForward != true)
      Button("Reload", systemImage: "arrow.clockwise") { browser.reload() }
        .disabled(!hasPage)
    }
    Section {
      Button("Close Tab", systemImage: "xmark", role: .destructive) { browser.closeSelectedTab() }
        .disabled(tab == nil)
    }
  }
}

struct CollapsedAddressLabel: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let text = browser.selectedTab?.host ?? "Orbit"
    Text(text)
      .font(.system(size: 13, weight: .semibold))
      .lineLimit(1)
      .padding(.horizontal, 14)
      .frame(height: 28)
      .glassEffect(.regular.interactive(), in: .capsule)
      .onTapGesture { browser.setChromeCollapsed(false) }
      .accessibilityLabel("Show toolbar, \(text)")
      .accessibilityAddTraits(.isButton)
  }
}

struct GlassCircleButton: View {
  let systemImage: String
  let label: String
  var size: CGFloat = 50
  var prominent = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: size * 0.38, weight: .semibold))
        .foregroundStyle(prominent ? Color.white : Color.primary)
        .frame(width: size, height: size)
        .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .glassEffect(prominent ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .circle)
    .hoverEffect(.lift)
    .accessibilityLabel(label)
  }
}

struct TabStackButton: View {
  @Environment(BrowserModel.self) private var browser
  var size: CGFloat = 50

  var body: some View {
    let preview = Array(browser.tabs.sorted { $0.lastActive > $1.lastActive }.prefix(2).reversed())
    Button {
      browser.showTabSwitcher()
    } label: {
      ZStack {
        if preview.isEmpty {
          Image(systemName: "square.on.square")
            .font(.system(size: size * 0.36, weight: .semibold))
        } else {
          ForEach(Array(preview.enumerated()), id: \.element.id) { index, tab in
            TabThumbnail(tab: tab)
              .frame(width: size * 0.42, height: size * 0.52)
              .rotationEffect(.degrees(preview.count == 1 ? -4 : (index == 0 ? -12 : 7)))
              .offset(x: preview.count == 1 ? 0 : (index == 0 ? -4 : 4))
          }
        }
      }
      .frame(width: size, height: size)
      .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .glassEffect(.regular.interactive(), in: .circle)
    .hoverEffect(.lift)
    .accessibilityLabel("Tabs")
    .accessibilityValue("\(browser.tabs.count) open")
  }
}

struct TabThumbnail: View {
  @Environment(BrowserModel.self) private var browser
  let tab: BrowserTab

  var body: some View {
    RoundedRectangle(cornerRadius: 5, style: .continuous)
      .fill(Color(white: 0.2))
      .overlay {
        if let snapshot = tab.snapshot {
          Image(uiImage: snapshot).resizable().scaledToFill()
        } else {
          Favicon(url: tab.url, size: 12)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(.white.opacity(0.7), lineWidth: 1.2))
      .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
      .onAppear { browser.loadSnapshotIfNeeded(tab) }
  }
}
