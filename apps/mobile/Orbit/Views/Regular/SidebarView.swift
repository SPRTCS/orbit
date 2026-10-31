import OrbitSync
import SwiftUI

struct SidebarView: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    VStack(spacing: 0) {
      SidebarTopBar()
        .padding(.horizontal, 10)
        .padding(.top, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          if browser.sync.client.spaces.count > 1 { SpacePicker() }
          if let space = browser.currentSpace, !space.pins.isEmpty { PinnedSection(space: space) }
          OpenTabsSection()
          if let space = browser.currentSpace {
            ForEach(browser.sync.devices(in: space)) { device in
              SidebarDeviceSection(device: device)
            }
          } else if browser.sync.isConnected {
            ForEach(browser.sync.recentDevices) { device in
              SidebarDeviceSection(device: device)
            }
          }
          if !browser.sync.isConnected {
            Button {
              browser.isShowingSyncSetup = true
            } label: {
              Label("Sync with your Mac", systemImage: "laptopcomputer.and.iphone")
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.fill.quaternary, in: .rect(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
          }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
      }
      .scrollIndicators(.hidden)
      .refreshable { await browser.sync.refresh() }
      SidebarFooter()
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }
  }
}

struct SidebarTopBar: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let tab = browser.selectedTab
    HStack(spacing: 2) {
      SidebarIconButton(systemImage: "sidebar.left", label: "Hide Sidebar") { browser.isSidebarVisible = false }
      Spacer(minLength: 0)
      SidebarIconButton(systemImage: "chevron.backward", label: "Back") { browser.goBack() }
        .disabled(tab?.canGoBack != true)
      SidebarIconButton(systemImage: "chevron.forward", label: "Forward") { browser.goForward() }
        .disabled(tab?.canGoForward != true)
      SidebarIconButton(systemImage: tab?.isLoading == true ? "xmark" : "arrow.clockwise", label: "Reload") {
        browser.reloadOrStop()
      }
      .disabled(tab?.url == nil)
    }
  }
}

struct SidebarIconButton: View {
  let systemImage: String
  let label: String
  let action: () -> Void
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 15, weight: .semibold))
        .frame(width: 34, height: 34)
        .contentShape(.rect(cornerRadius: 8))
    }
    .buttonStyle(.plain)
    .foregroundStyle(isEnabled ? .primary : .tertiary)
    .hoverEffect(.highlight)
    .accessibilityLabel(label)
  }
}

struct SpacePicker: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let current = browser.currentSpace?.id
    VStack(alignment: .leading, spacing: 6) {
      ScrollView(.horizontal) {
        HStack(spacing: 6) {
          ForEach(browser.sync.client.spaces) { space in
            Button {
              withAnimation(.snappy) { browser.selectedSpaceID = space.id }
            } label: {
              SpaceIcon(space: space, size: 16)
                .frame(width: 36, height: 32)
                .background(
                  space.id == current ? AnyShapeStyle(space.tint.opacity(0.3)) : AnyShapeStyle(.clear),
                  in: .rect(cornerRadius: 9, style: .continuous))
                .contentShape(.rect(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(space.name)
            .accessibilityAddTraits(space.id == current ? .isSelected : [])
          }
        }
      }
      .scrollIndicators(.hidden)
      if let space = browser.currentSpace {
        Text(space.name)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.leading, 4)
      }
    }
  }
}

struct SidebarSectionHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.caption.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.leading, 6)
  }
}

struct PinnedSection: View {
  @Environment(BrowserModel.self) private var browser
  let space: SyncedSpace

  var body: some View {
    let layout = PinLayout(pins: space.pins)
    VStack(alignment: .leading, spacing: 2) {
      SidebarSectionHeader(title: "Pinned on Mac")
      if !layout.tiles.isEmpty {
        PinTileGrid(tiles: layout.tiles, minimumWidth: 52)
          .padding(.bottom, 6)
      }
      ForEach(layout.sections) { section in
        if section.path.isEmpty {
          SidebarPinEntries(entries: section.entries)
        } else {
          SidebarFolder(section: section)
        }
      }
    }
  }
}

struct SidebarPinEntries: View {
  let entries: [PinLayout.Entry]

  var body: some View {
    ForEach(entries) { entry in
      switch entry {
      case .pin(let pin):
        SidebarPinRow(pin: pin)
      case .group(let group, let members):
        VStack(alignment: .leading, spacing: 2) {
          Label(group.title.isEmpty ? "Tab Group" : group.title, systemImage: "square.split.2x1")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.top, 4)
          ForEach(members) { pin in SidebarPinRow(pin: pin).padding(.leading, 10) }
        }
      }
    }
  }
}

struct SidebarFolder: View {
  let section: PinLayout.Section
  @State private var isExpanded = true

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Button {
        withAnimation(.snappy) { isExpanded.toggle() }
      } label: {
        HStack(spacing: 8) {
          Image(systemName: isExpanded ? "folder" : "folder.fill")
            .frame(width: 20)
          Text(section.title).lineLimit(1)
          Spacer(minLength: 0)
          Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
            .foregroundStyle(.tertiary)
        }
        .font(.system(size: 14, weight: .medium))
        .padding(.horizontal, 8)
        .frame(height: 34)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .hoverEffect(.highlight)
      if isExpanded {
        SidebarPinEntries(entries: section.entries)
          .padding(.leading, 14)
      }
    }
  }
}

struct SidebarPinRow: View {
  @Environment(BrowserModel.self) private var browser
  let pin: SyncedPin

  var body: some View {
    if let url = pin.url {
      SidebarRow(
        title: pin.title, url: url,
        isSelected: browser.selectedTab?.url.map(Omnibox.matchKey) == Omnibox.matchKey(url),
        close: nil
      ) {
        browser.openSynced(url)
      }
    }
  }
}

struct OpenTabsSection: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      SidebarSectionHeader(title: "Tabs")
      Button {
        browser.beginNewTab()
      } label: {
        Label("New Tab", systemImage: "plus")
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 8)
          .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .hoverEffect(.highlight)
      ForEach(browser.tabs.reversed()) { tab in
        SidebarRow(
          title: tab.displayTitle, url: tab.url, isSelected: tab.id == browser.selectedTabID,
          isLoading: tab.isLoading, close: { withAnimation(.snappy) { browser.close(tab) } }
        ) {
          browser.select(tab)
        }
        .contextMenu {
          if let url = tab.url {
            Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = url }
            Button("Share", systemImage: "square.and.arrow.up") { UIKitPresenter.share(url, title: tab.title) }
          }
          Button("Close Tab", systemImage: "xmark", role: .destructive) { browser.close(tab) }
        }
      }
    }
  }
}

struct SidebarDeviceSection: View {
  @Environment(BrowserModel.self) private var browser
  let device: SyncedDevice
  @State private var isExpanded = true

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Button {
        withAnimation(.snappy) { isExpanded.toggle() }
      } label: {
        HStack(spacing: 6) {
          Image(systemName: device.systemImage)
          Text(device.name).lineLimit(1)
          Spacer(minLength: 0)
          Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .frame(height: 24)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      if isExpanded {
        ForEach(Array(device.tabs.enumerated()), id: \.offset) { _, tab in
          SidebarRow(title: tab.title, url: tab.url, isSelected: false, close: nil) {
            browser.openSynced(tab.url)
          }
        }
      }
    }
  }
}

struct SidebarRow: View {
  let title: String
  let url: URL?
  let isSelected: Bool
  var isLoading = false
  let close: (() -> Void)?
  let action: () -> Void
  @State private var isHovering = false

  var body: some View {
    HStack(spacing: 8) {
      ZStack {
        Favicon(url: url, size: 16)
          .opacity(isLoading ? 0.35 : 1)
        if isLoading { ProgressView().controlSize(.mini) }
      }
      .frame(width: 20)
      Text(title)
        .font(.system(size: 14, weight: isSelected ? .semibold : .medium))
        .lineLimit(1)
      Spacer(minLength: 0)
      if let close, isHovering || isSelected {
        Button(action: close) {
          Image(systemName: "xmark")
            .font(.system(size: 10, weight: .bold))
            .frame(width: 22, height: 22)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Close \(title)")
      }
    }
    .padding(.horizontal, 8)
    .frame(height: 34)
    .background(
      isSelected ? AnyShapeStyle(.background.opacity(0.7)) : (isHovering ? AnyShapeStyle(.fill.quaternary) : AnyShapeStyle(.clear)),
      in: .rect(cornerRadius: 9, style: .continuous)
    )
    .contentShape(.rect)
    .onTapGesture(perform: action)
    .onHover { isHovering = $0 }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
  }
}

struct SidebarFooter: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    HStack(spacing: 2) {
      SidebarIconButton(systemImage: "gearshape", label: "Settings") { browser.isShowingSettings = true }
      SidebarIconButton(systemImage: "square.grid.2x2", label: "All Tabs") { browser.showTabSwitcher() }
      Spacer(minLength: 0)
      if browser.sync.isConnected {
        Text(browser.sync.statusText)
          .font(.caption2)
          .foregroundStyle(.tertiary)
          .lineLimit(1)
        SidebarIconButton(systemImage: "arrow.triangle.2.circlepath", label: "Sync Now") {
          browser.sync.refreshInBackground()
        }
        .symbolEffect(.rotate, isActive: browser.sync.isSyncing)
      }
      SidebarIconButton(systemImage: "laptopcomputer.and.iphone", label: "Devices and Spaces") {
        browser.isShowingDevices = true
      }
    }
  }
}
