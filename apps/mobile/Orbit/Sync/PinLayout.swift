import Foundation
import OrbitSync
import SwiftUI

struct PinFolderInfo: Hashable {
  let id: String
  let name: String
  let emoji: String?
  let color: String?

  var tint: Color? {
    guard let color else { return nil }
    if let preset = ProfileColor(rawValue: color.lowercased()) { return Color(hex: preset.swatch) }
    return Color(hex: color)
  }
}

struct PinTree {
  indirect enum Node: Identifiable {
    case pin(SyncedPin)
    case group(SyncedPin, members: [SyncedPin])
    case folder(PinFolderInfo, children: [Node])

    var id: String {
      switch self {
      case .pin(let pin): pin.id
      case .group(let group, _): group.id
      case .folder(let folder, _): "folder:\(folder.id)"
      }
    }
  }

  private enum Entry {
    case folder(String)
    case item(Node)
  }

  let tiles: [SyncedPin]
  let roots: [Node]

  var isEmpty: Bool { tiles.isEmpty && roots.isEmpty }

  init(space: SyncedSpace) {
    self.init(pins: space.pins, folders: space.folders)
  }

  init(pins: [SyncedPin], folders: [SyncedFolder]) {
    var info: [String: PinFolderInfo] = [:]
    var parents: [String: String] = [:]
    var folderOrder: [String] = []
    for folder in folders {
      info[folder.id] = PinFolderInfo(id: folder.id, name: folder.name, emoji: folder.emoji, color: folder.color)
      if let parent = folder.parentId { parents[folder.id] = parent }
      folderOrder.append(folder.id)
    }

    func folderKey(for pin: SyncedPin) -> String? {
      if let id = pin.folderId, info[id] != nil { return id }
      guard !pin.folderPath.isEmpty else { return nil }
      var parent: String?
      for depth in 1...pin.folderPath.count {
        let id = "path:" + pin.folderPath.prefix(depth).joined(separator: "/")
        if info[id] == nil {
          info[id] = PinFolderInfo(id: id, name: pin.folderPath[depth - 1], emoji: nil, color: nil)
          folderOrder.append(id)
          if let parent { parents[id] = parent }
        }
        parent = id
      }
      return parent
    }

    let groupIDs = Set(pins.filter { $0.isGroup && !$0.isTile }.map(\.id))
    var members: [String: [SyncedPin]] = [:]
    for pin in pins where !pin.isTile {
      if let group = pin.groupId, groupIDs.contains(group) { members[group, default: []].append(pin) }
    }

    var tiles: [SyncedPin] = []
    var entries: [String: [Entry]] = [:]
    var placed: Set<String> = []

    func place(_ folder: String) {
      guard !placed.contains(folder) else { return }
      placed.insert(folder)
      let parent = parents[folder].flatMap { info[$0] != nil ? $0 : nil }
      if let parent { place(parent) }
      entries[parent ?? "", default: []].append(.folder(folder))
    }

    for pin in pins {
      if pin.isTile {
        if pin.url != nil { tiles.append(pin) }
        continue
      }
      if let group = pin.groupId, groupIDs.contains(group) { continue }
      let node: Node
      if pin.isGroup {
        node = .group(pin, members: members[pin.id] ?? [])
      } else if pin.url != nil {
        node = .pin(pin)
      } else {
        continue
      }
      let key = folderKey(for: pin)
      if let key { place(key) }
      entries[key ?? "", default: []].append(.item(node))
    }
    for folder in folderOrder where !placed.contains(folder) { place(folder) }

    func build(_ key: String) -> [Node] {
      (entries[key] ?? []).compactMap { entry in
        switch entry {
        case .item(let node): node
        case .folder(let id): info[id].map { .folder($0, children: build(id)) }
        }
      }
    }

    self.tiles = tiles
    roots = build("")
  }
}

@Observable
final class PinFolderState {
  private static let key = "collapsedPinFolders"
  @ObservationIgnored private let defaults: UserDefaults
  private(set) var collapsed: Set<String>

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    collapsed = Set(defaults.stringArray(forKey: Self.key) ?? [])
  }

  func isExpanded(_ id: String) -> Bool { !collapsed.contains(id) }

  func toggle(_ id: String) {
    if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
    defaults.set(Array(collapsed), forKey: Self.key)
  }

  func binding(_ id: String) -> Binding<Bool> {
    Binding(get: { self.isExpanded(id) }, set: { expanded in
      if expanded != self.isExpanded(id) { self.toggle(id) }
    })
  }
}
