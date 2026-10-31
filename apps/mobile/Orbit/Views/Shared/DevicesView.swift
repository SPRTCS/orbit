import OrbitSync
import SwiftUI

struct DevicesView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let sync = browser.sync
    NavigationStack {
      List {
        Section {
          HStack(spacing: 12) {
            Image(systemName: sync.isConnected ? "checkmark.icloud" : "icloud.slash")
              .font(.title3)
              .foregroundStyle(sync.isConnected ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
              Text(sync.isConnected ? "Synced with Orbit for Mac" : "Sync is off")
                .font(.body.weight(.semibold))
              Text(sync.statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if sync.isSyncing { ProgressView() }
          }
          if !sync.isConnected {
            NavigationLink("Set Up Sync") { SyncSetupView() }
          }
        }

        ForEach(sync.client.spaces) { space in
          SpaceSection(space: space, devices: sync.devices(in: space))
        }

        let unassigned = sync.client.spaces.isEmpty ? sync.recentDevices : []
        ForEach(unassigned) { device in
          Section(device.name) { DeviceTabRows(device: device) }
        }
      }
      .refreshable { await sync.refresh() }
      .navigationTitle("Devices & Spaces")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
  }
}

struct SpaceSection: View {
  @Environment(BrowserModel.self) private var browser
  let space: SyncedSpace
  let devices: [SyncedDevice]

  var body: some View {
    let tree = PinTree(space: space)
    Section {
      if !tree.tiles.isEmpty {
        PinTileGrid(tiles: tree.tiles, minimumWidth: 64)
          .padding(.vertical, 4)
      }
      PinNodeRows(nodes: tree.roots)
      ForEach(devices) { device in
        DisclosureGroup {
          DeviceTabRows(device: device)
        } label: {
          DeviceLabel(device: device)
        }
      }
      if tree.isEmpty && devices.isEmpty {
        Text("Nothing pinned yet")
          .foregroundStyle(.secondary)
      }
    } header: {
      HStack(spacing: 6) {
        SpaceIcon(space: space, size: 15)
        Text(space.name)
        Circle().fill(space.tint).frame(width: 7, height: 7)
      }
    }
  }
}

struct PinNodeRows: View {
  @Environment(BrowserModel.self) private var browser
  let nodes: [PinTree.Node]

  var body: some View {
    ForEach(nodes) { node in
      switch node {
      case .pin(let pin):
        PinRow(pin: pin)
      case .group(let group, let members):
        DisclosureGroup {
          ForEach(members) { pin in PinRow(pin: pin) }
        } label: {
          Label(group.title.isEmpty ? "Tab Group" : group.title, systemImage: "square.split.2x1")
        }
      case .folder(let folder, let children):
        DisclosureGroup(isExpanded: browser.pinFolders.binding(folder.id)) {
          PinNodeRows(nodes: children)
        } label: {
          HStack(spacing: 10) {
            FolderGlyph(folder: folder, expanded: browser.pinFolders.isExpanded(folder.id))
            Text(folder.name)
          }
        }
      }
    }
  }
}

struct PinTileGrid: View {
  @Environment(BrowserModel.self) private var browser
  let tiles: [SyncedPin]
  var columns: Int?
  var minimumWidth: CGFloat = 64

  private var gridItems: [GridItem] {
    if let columns {
      return Array(repeating: GridItem(.flexible(), spacing: 8), count: columns)
    }
    return [GridItem(.adaptive(minimum: minimumWidth), spacing: 8)]
  }

  var body: some View {
    LazyVGrid(columns: gridItems, spacing: 8) {
      ForEach(tiles) { tile in
        if let url = tile.url {
          Button {
            browser.openPin(tile)
          } label: {
            PinTile(url: url, isSelected: browser.isPinSelected(tile))
          }
          .buttonStyle(.plain)
          .hoverEffect(.highlight)
          .accessibilityLabel(tile.title)
          .accessibilityAddTraits(browser.isPinSelected(tile) ? .isSelected : [])
          .contextMenu { PinMenu(pin: tile) }
        }
      }
    }
  }
}

struct PinTile: View {
  let url: URL
  var isSelected = false

  var body: some View {
    Color.clear
      .aspectRatio(1.4, contentMode: .fit)
      .overlay {
        GeometryReader { proxy in
          let radius = min(max(proxy.size.width * 0.16, 10), 16)
          let iconSize = min(max(proxy.size.height * 0.38, 18), 28)
          Favicon(url: url, size: iconSize)
            .frame(width: proxy.size.width, height: proxy.size.height)
            .background(
              isSelected ? AnyShapeStyle(.background.opacity(0.85)) : AnyShapeStyle(.fill.tertiary),
              in: .rect(cornerRadius: radius, style: .continuous)
            )
            .overlay {
              if isSelected {
                RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.accentColor, lineWidth: 2)
              }
            }
            .contentShape(.rect(cornerRadius: radius, style: .continuous))
        }
      }
  }
}

struct PinRow: View {
  @Environment(BrowserModel.self) private var browser
  let pin: SyncedPin

  var body: some View {
    if let url = pin.url {
      Button {
        browser.openPin(pin)
      } label: {
        HStack(spacing: 12) {
          Favicon(url: url, size: 20)
          VStack(alignment: .leading, spacing: 1) {
            Text(pin.title).lineLimit(1)
            Text(Omnibox.displayHost(url)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
          Image(systemName: browser.isPinSelected(pin) ? "checkmark.circle.fill" : "pin.fill")
            .font(.caption)
            .foregroundStyle(browser.isPinSelected(pin) ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.tertiary))
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .contextMenu { PinMenu(pin: pin) }
    }
  }
}

struct DeviceLabel: View {
  let device: SyncedDevice

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: device.systemImage)
        .foregroundStyle(.secondary)
        .frame(width: 22)
      VStack(alignment: .leading, spacing: 1) {
        Text(device.name).font(.body.weight(.medium))
        Text(subtitle).font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var subtitle: String {
    let count = device.tabs.count == 1 ? "1 tab" : "\(device.tabs.count) tabs"
    guard let updatedAt = device.updatedAt else { return count }
    return "\(count) · \(updatedAt.formatted(.relative(presentation: .named)))"
  }
}

struct DeviceTabRows: View {
  @Environment(BrowserModel.self) private var browser
  let device: SyncedDevice

  var body: some View {
    ForEach(Array(device.tabs.enumerated()), id: \.offset) { _, tab in
      Button {
        browser.openSynced(tab.url)
      } label: {
        HStack(spacing: 12) {
          Favicon(url: tab.url, size: 20)
          VStack(alignment: .leading, spacing: 1) {
            Text(tab.title).lineLimit(1)
            Text(Omnibox.displayHost(tab.url)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
    }
    if device.tabs.isEmpty {
      Text("No open tabs").foregroundStyle(.secondary)
    }
  }
}
