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
    let layout = PinLayout(pins: space.pins)
    Section {
      if !layout.tiles.isEmpty {
        PinTileGrid(tiles: layout.tiles, minimumWidth: 64)
          .padding(.vertical, 4)
      }
      ForEach(layout.sections) { section in
        if section.path.isEmpty {
          PinEntryRows(entries: section.entries)
        } else {
          DisclosureGroup {
            PinEntryRows(entries: section.entries)
          } label: {
            Label(section.title, systemImage: "folder")
          }
        }
      }
      ForEach(devices) { device in
        DisclosureGroup {
          DeviceTabRows(device: device)
        } label: {
          DeviceLabel(device: device)
        }
      }
      if layout.isEmpty && devices.isEmpty {
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

struct PinEntryRows: View {
  let entries: [PinLayout.Entry]

  var body: some View {
    ForEach(entries) { entry in
      switch entry {
      case .pin(let pin):
        PinRow(pin: pin)
      case .group(let group, let members):
        DisclosureGroup {
          ForEach(members) { pin in PinRow(pin: pin) }
        } label: {
          Label(group.title.isEmpty ? "Tab Group" : group.title, systemImage: "square.split.2x1")
        }
      }
    }
  }
}

struct PinTileGrid: View {
  @Environment(BrowserModel.self) private var browser
  let tiles: [SyncedPin]
  var minimumWidth: CGFloat = 56

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: minimumWidth), spacing: 8)], spacing: 8) {
      ForEach(tiles) { tile in
        if let url = tile.url {
          Button {
            browser.openSynced(url)
          } label: {
            Favicon(url: url, size: 22)
              .frame(maxWidth: .infinity, minHeight: 44)
              .background(.fill.tertiary, in: .rect(cornerRadius: 12, style: .continuous))
              .contentShape(.rect(cornerRadius: 12))
          }
          .buttonStyle(.plain)
          .hoverEffect(.highlight)
          .accessibilityLabel(tile.title)
          .contextMenu {
            Button("Open in New Tab", systemImage: "plus.square.on.square") { browser.openSynced(url) }
            Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = url }
          }
        }
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
        browser.openSynced(url)
      } label: {
        HStack(spacing: 12) {
          Favicon(url: url, size: 20)
          VStack(alignment: .leading, spacing: 1) {
            Text(pin.title).lineLimit(1)
            Text(Omnibox.displayHost(url)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
          Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
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
