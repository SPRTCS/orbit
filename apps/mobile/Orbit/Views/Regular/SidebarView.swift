import OrbitSync
import SwiftUI

struct SidebarView: View {
  @Environment(BrowserModel.self) private var browser
  let width: CGFloat
  let safeArea: EdgeInsets
  let edgeGap: CGFloat
  @State private var topRow = TopRowGeometry()

  var body: some View {
    VStack(spacing: 0) {
      SidebarTopBar()
        .padding(.leading, topRowLeading)
        .padding(.trailing, 10)
        .padding(.top, SidebarLayout.topRowInset(edgeGap: edgeGap, statusBarOverlap: topRow.statusBarOverlap))
        .background {
          LayoutRegionInsetsReader { topRow = $0 }
        }
        .zIndex(1)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          if browser.sync.client.spaces.count > 1 { SpacePicker() }
          if let space = browser.currentSpace, !space.pins.isEmpty {
            PinnedSection(space: space, tileColumns: SidebarWidth.tileColumns(forSidebarWidth: width))
          }
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
        .padding(.leading, safeArea.leading + 10)
        .padding(.trailing, 10)
        .padding(.vertical, 12)
      }
      .scrollIndicators(.hidden)
      .refreshable { await browser.sync.refresh() }
      SidebarFooter()
        .padding(.leading, SidebarLayout.footerLeading(edgeGap: edgeGap, safeLeading: safeArea.leading))
        .padding(.trailing, 10)
        .padding(.top, 6)
        .padding(.bottom, edgeGap)
    }
  }
}

extension SidebarView {
  private var topRowLeading: CGFloat {
    SidebarLayout.topRowLeading(
      edgeGap: edgeGap, safeLeading: safeArea.leading, cornerAdaptedLeading: topRow.cornerInsets.leading)
  }
}

enum SidebarLayout {
  static let iconButtonSize: CGFloat = 44
  static let statusBarClearance: CGFloat = 4
  static let windowControlsThreshold: CGFloat = 30

  static func footerLeading(edgeGap: CGFloat, safeLeading: CGFloat) -> CGFloat {
    max(edgeGap, safeLeading + 8)
  }

  static func topRowInset(edgeGap: CGFloat, statusBarOverlap: CGFloat = 0) -> CGFloat {
    let mirrored = edgeGap + (ChromeMetrics.regularControlSize - iconButtonSize) / 2
    guard statusBarOverlap > 0 else { return mirrored }
    return max(mirrored, statusBarOverlap + statusBarClearance)
  }

  static func topRowLeading(edgeGap: CGFloat, safeLeading: CGFloat, cornerAdaptedLeading: CGFloat) -> CGFloat {
    let mirrored = footerLeading(edgeGap: edgeGap, safeLeading: safeLeading) + (ChromeMetrics.regularControlSize - iconButtonSize) / 2
    let hasWindowControls = cornerAdaptedLeading > safeLeading + windowControlsThreshold
    return hasWindowControls ? max(mirrored, cornerAdaptedLeading) : mirrored
  }
}

struct SidebarTopBar: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let tab = browser.selectedTab
    HStack(spacing: 0) {
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
        .frame(width: SidebarLayout.iconButtonSize, height: SidebarLayout.iconButtonSize)
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
            .contextMenu {
              Button("Edit Theme…", systemImage: "paintpalette") { browser.themeEditTarget = ThemeEditTarget(space: space) }
            }
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
  let tileColumns: Int

  var body: some View {
    let tree = PinTree(space: space)
    VStack(alignment: .leading, spacing: 2) {
      SidebarSectionHeader(title: "Pinned on Mac")
      if !tree.tiles.isEmpty {
        PinTileGrid(tiles: tree.tiles, columns: tileColumns)
          .padding(.bottom, 6)
      }
      SidebarPinNodes(nodes: tree.roots, depth: 0)
    }
  }
}

struct SidebarPinNodes: View {
  let nodes: [PinTree.Node]
  let depth: Int

  var body: some View {
    ForEach(nodes) { node in
      switch node {
      case .pin(let pin):
        SidebarPinRow(pin: pin)
          .padding(.leading, CGFloat(depth) * 14)
      case .group(let group, let members):
        VStack(alignment: .leading, spacing: 2) {
          Label(group.title.isEmpty ? "Tab Group" : group.title, systemImage: "square.split.2x1")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.top, 4)
          ForEach(members) { pin in SidebarPinRow(pin: pin).padding(.leading, 10) }
        }
        .padding(.leading, CGFloat(depth) * 14)
      case .folder(let folder, let children):
        SidebarFolder(folder: folder, children: children, depth: depth)
      }
    }
  }
}

struct SidebarFolder: View {
  @Environment(BrowserModel.self) private var browser
  let folder: PinFolderInfo
  let children: [PinTree.Node]
  let depth: Int

  var body: some View {
    let expanded = browser.pinFolders.isExpanded(folder.id)
    VStack(alignment: .leading, spacing: 2) {
      Button {
        withAnimation(.snappy) { browser.pinFolders.toggle(folder.id) }
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .rotationEffect(.degrees(expanded ? 90 : 0))
            .foregroundStyle(.tertiary)
            .frame(width: 10)
          FolderGlyph(folder: folder, expanded: expanded)
          Text(folder.name).lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.system(size: 14, weight: .medium))
        .padding(.horizontal, 8)
        .frame(height: 34)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .hoverEffect(.highlight)
      .padding(.leading, CGFloat(depth) * 14)
      .accessibilityLabel(folder.name)
      .accessibilityValue(expanded ? "Expanded" : "Collapsed")
      if expanded {
        SidebarPinNodes(nodes: children, depth: depth + 1)
      }
    }
  }
}

struct FolderGlyph: View {
  let folder: PinFolderInfo
  let expanded: Bool

  var body: some View {
    Group {
      if let emoji = folder.emoji, !emoji.isEmpty {
        Text(emoji).font(.system(size: 14))
      } else {
        Image(systemName: expanded ? "folder" : "folder.fill")
          .foregroundStyle(folder.tint ?? .secondary)
      }
    }
    .frame(width: 20)
  }
}

struct SidebarPinRow: View {
  @Environment(BrowserModel.self) private var browser
  let pin: SyncedPin

  var body: some View {
    if let url = pin.url {
      let tab = browser.pinTab(for: pin)
      SidebarRow(
        title: tab.map { $0.title.isEmpty ? pin.title : $0.title } ?? pin.title,
        url: tab?.url ?? url,
        isSelected: browser.isPinSelected(pin),
        isLoading: tab?.isLoading ?? false,
        close: tab.map { tab in { browser.closePinTab(tab) } }
      ) {
        browser.openPin(pin)
      }
      .contextMenu { PinMenu(pin: pin) }
    }
  }
}

struct PinMenu: View {
  @Environment(BrowserModel.self) private var browser
  let pin: SyncedPin

  var body: some View {
    if browser.pinTab(for: pin) != nil {
      Button("Back to Pinned URL", systemImage: "arrow.uturn.backward") { browser.returnToPinnedURL(pin) }
    }
    if let url = pin.url {
      Button("Open in New Tab", systemImage: "plus.square.on.square") { browser.open(url, inNewTab: true) }
      Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = url }
    }
    if let tab = browser.pinTab(for: pin) {
      Button("Unload Pin", systemImage: "xmark", role: .destructive) { browser.closePinTab(tab) }
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
  @Namespace private var glass

  private let buttonSize = ChromeMetrics.regularControlSize

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if case .failed(let message) = browser.sync.client.state {
        Button {
          browser.isShowingSettings = true
        } label: {
          Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityHint("Opens Settings")
      }
      GlassEffectContainer(spacing: 10) {
        HStack(spacing: 10) {
          GlassCircleButton(systemImage: "gearshape", label: "Settings", size: buttonSize, glassNamespace: glass) {
            browser.isShowingSettings = true
          }
          GlassCircleButton(systemImage: "square.grid.2x2", label: "All Tabs", size: buttonSize, glassNamespace: glass) {
            browser.showTabSwitcher()
          }
          Spacer(minLength: 0)
          GlassCircleButton(
            systemImage: "laptopcomputer.and.iphone", label: "Devices and Spaces", size: buttonSize, glassNamespace: glass
          ) {
            browser.isShowingDevices = true
          }
        }
      }
    }
  }
}
