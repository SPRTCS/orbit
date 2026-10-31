import Foundation

struct SyncedViews: Sendable, Equatable {
  var spaces: [SyncedSpace] = []
  var devices: [SyncedDevice] = []
  var pending = 0
}

enum SpaceKeys {
  static let profile = "prof:"
  static let theme = "pth:"
  static let device = "dev:"
  static let tabs = "tabs:"
  static let pin = "pin:"
  static let pinRow = "pinrow:"
  static let pinFolder = "pinfolder:"
  static let appScope = "app"

  static let appPrefixes = [profile, theme, device]
  static let spacePrefixes = [tabs, pin, pinRow, pinFolder]
  static let cacheSignature = (appPrefixes + ["|"] + spacePrefixes).joined(separator: ",")

  static func scope(ofSpace syncId: String) -> String { "p:\(syncId)" }

  static func keepsApp(_ key: String) -> Bool { appPrefixes.contains { key.hasPrefix($0) } }

  static func keepsSpace(_ key: String) -> Bool { spacePrefixes.contains { key.hasPrefix($0) } }

  static func spaceIds(in app: ScopeReplica) -> [String] {
    app.visible(profile).keys.map { String($0.dropFirst(profile.count)) }.sorted(by: jsLess)
  }

  static func defaultSpaceId(in app: ScopeReplica) -> String? {
    let profiles = app.visible(profile)
    let ids = spaceIds(in: app)
    return ids.first { profiles[profile + $0]?["d"]?.bool == true } ?? ids.first
  }
}

struct PinnedTree {
  struct Folder {
    var id: String
    var name: String
    var children: [String]
  }

  var root: [String]
  var folders: [String: Folder]

  static func isFolderRef(_ ref: String) -> Bool { ref.hasPrefix("f:") }
  static func isLeafRef(_ ref: String) -> Bool { ref.hasPrefix("t:") || ref.hasPrefix("g:") }
  static func isAppearanceRef(_ ref: String) -> Bool { ref.hasPrefix("a:") && ref.count > 2 }
  static func folderId(of ref: String) -> String { String(ref.dropFirst(2)) }
  static func folderRef(_ id: String) -> String { "f:\(id)" }

  struct Node {
    var p: String?
    var pos: String
    var n: String?
  }

  static func nodeValue(_ ref: String, _ raw: JSONValue) -> Node? {
    guard let object = raw.object, let pos = object["pos"]?.string, !pos.isEmpty else { return nil }
    let parent: String?
    switch object["p"] {
    case .some(.null): parent = nil
    case .some(.string(let value)): parent = value
    default: return nil
    }
    if isFolderRef(ref) {
      guard let name = object["n"]?.string, ref.count > 2 else { return nil }
      return Node(p: parent, pos: pos, n: name)
    }
    return isLeafRef(ref) && ref.count > 2 ? Node(p: parent, pos: pos, n: nil) : nil
  }

  static func breakCycles(_ parent: inout [String: String?], _ folderIds: [String]) {
    for id in folderIds.sorted(by: jsLess) {
      while true {
        var path: [String] = []
        var at: String? = id
        while let current = at, !path.contains(current) {
          path.append(current)
          at = parent[current] ?? nil
        }
        guard let loop = at, let start = path.firstIndex(of: loop) else { break }
        let lowest = path[start...].sorted(by: jsLess)[0]
        parent[lowest] = .some(nil)
      }
    }
  }

  init(records: [String: JSONValue], pinGone: (String) -> Bool) {
    var folders: [String: Node] = [:]
    var nodes: [String: Node] = [:]
    for (key, raw) in records where key.hasPrefix(SpaceKeys.pinFolder) {
      let ref = String(key.dropFirst(SpaceKeys.pinFolder.count))
      if Self.isAppearanceRef(ref) { continue }
      guard let value = Self.nodeValue(ref, raw) else { continue }
      if Self.isFolderRef(ref) {
        folders[Self.folderId(of: ref)] = value
      } else if pinGone(ref) {
        continue
      }
      nodes[ref] = value
    }
    func parentOf(_ ref: String, _ node: Node) -> String? {
      guard let p = node.p, folders[p] != nil, !Self.isFolderRef(ref) || p != Self.folderId(of: ref) else { return nil }
      return p
    }
    var folderParent: [String: String?] = [:]
    for (id, node) in folders { folderParent[id] = .some(parentOf(Self.folderRef(id), node)) }
    Self.breakCycles(&folderParent, Array(folders.keys))
    var children: [String?: [String]] = [nil: []]
    for (ref, node) in nodes {
      let parent = Self.isFolderRef(ref) ? (folderParent[Self.folderId(of: ref)] ?? nil) : parentOf(ref, node)
      children[parent, default: []].append(ref)
    }
    for (parent, list) in children {
      children[parent] = list.sorted { a, z in
        let pa = nodes[a]!.pos
        let pz = nodes[z]!.pos
        if pa != pz { return jsLess(pa, pz) }
        return jsLess(a, z)
      }
    }
    root = children[nil] ?? []
    var built: [String: Folder] = [:]
    for (id, node) in folders { built[id] = Folder(id: id, name: node.n ?? "", children: children[id] ?? []) }
    self.folders = built
  }
}

enum ViewBuilder {
  struct PinTab {
    var id: String
    var group: String?
    var url: String
    var title: String
    var pos: String
  }

  struct PinGroup {
    var id: String
    var name: String
    var pos: String
  }

  static func build(app: ScopeReplica, spaces: [String: ScopeReplica], me: String) -> SyncedViews {
    var views = SyncedViews()
    let profiles = app.visible(SpaceKeys.profile)
    var built: [SyncedSpace] = []
    for (key, value) in profiles {
      let id = String(key.dropFirst(SpaceKeys.profile.count))
      let pinned = spaces[id].map(pinned(in:))
      built.append(SyncedSpace(
        id: id,
        name: value["n"]?.string ?? "",
        color: value["c"]?.string,
        icon: value["i"]?.string,
        isDefault: value["d"]?.bool == true,
        pins: pinned?.pins ?? [],
        theme: theme(of: id, profile: value, app: app),
        folders: pinned?.folders ?? []
      ))
    }
    views.spaces = built.sorted { a, z in
      if a.isDefault != z.isDefault { return a.isDefault }
      let order = a.name.localizedStandardCompare(z.name)
      if order != .orderedSame { return order == .orderedAscending }
      return jsLess(a.id, z.id)
    }
    var names: [String: String] = [:]
    for (key, value) in app.visible(SpaceKeys.device) { names[String(key.dropFirst(SpaceKeys.device.count))] = value["n"]?.string ?? "" }
    var devices: [SyncedDevice] = []
    for space in views.spaces {
      guard let scope = spaces[space.id] else { continue }
      for (key, value) in scope.visible(SpaceKeys.tabs) {
        let deviceId = String(key.dropFirst(SpaceKeys.tabs.count))
        guard deviceId != me, let known = names[deviceId] else { continue }
        let tabs = (value["tabs"]?.array ?? []).compactMap { tab -> SyncedTab? in
          guard let address = tab["u"]?.string, let url = URL(string: address) else { return nil }
          return SyncedTab(url: url, title: tab["t"]?.string ?? "")
        }
        guard !tabs.isEmpty else { continue }
        let name = !known.isEmpty ? known : (value["n"]?.string).flatMap { $0.isEmpty ? nil : $0 } ?? "Unknown Device"
        let changed = Double(HybridClock.wall(of: scope.records[key]?.h ?? ""))
        let updated = max(changed, scope.seen[deviceId] ?? 0)
        devices.append(SyncedDevice(
          id: "\(space.id)/\(deviceId)",
          name: name,
          spaceId: space.id,
          tabs: tabs,
          updatedAt: updated > 0 ? Date(timeIntervalSince1970: updated / 1000) : nil,
          deviceId: deviceId,
          kind: value["k"]?.string
        ))
      }
    }
    views.devices = devices.sorted { a, z in
      let ta = a.updatedAt ?? .distantPast
      let tz = z.updatedAt ?? .distantPast
      if ta != tz { return ta > tz }
      if a.name != z.name { return a.name.localizedStandardCompare(z.name) == .orderedAscending }
      return jsLess(a.id, z.id)
    }
    views.pending = app.pending + spaces.values.reduce(0) { $0 + $1.pending }
    return views
  }

  static func theme(of id: String, profile: JSONValue, app: ScopeReplica) -> SyncedTheme? {
    if let record = app.records[SpaceKeys.theme + id] { return SyncedTheme(record: record.v) }
    return SyncedTheme(json: profile["th"])
  }

  static func byPosition(_ a: (id: String, pos: String), _ z: (id: String, pos: String)) -> Bool {
    if a.pos != z.pos { return jsLess(a.pos, z.pos) }
    return jsLess(a.id, z.id)
  }

  static func pins(in scope: ScopeReplica) -> [SyncedPin] { pinned(in: scope).pins }

  static let folderColors: Set<String> = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]

  static func folderEmoji(_ value: String?) -> String? {
    guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, text.utf16.count <= 32 else { return nil }
    func within(_ cp: UInt32, _ ranges: [ClosedRange<UInt32>]) -> Bool { ranges.contains { $0.contains(cp) } }
    let pictographs: [ClosedRange<UInt32>] = [
      0xa9...0xa9, 0xae...0xae, 0x203c...0x203c, 0x2049...0x2049, 0x2122...0x2122, 0x2139...0x2139, 0x2194...0x21aa,
      0x231a...0x23ff, 0x24c2...0x24c2, 0x25aa...0x25fe, 0x2600...0x27bf, 0x2934...0x2935, 0x2b05...0x2b55,
      0x3030...0x3030, 0x303d...0x303d, 0x3297...0x3299, 0x1f000...0x1f1e5, 0x1f200...0x1faff,
    ]
    let regional: [ClosedRange<UInt32>] = [0x1f1e6...0x1f1ff]
    let modifiers: [ClosedRange<UInt32>] = [0xfe0e...0xfe0f, 0x1f3fb...0x1f3ff, 0x20e3...0x20e3, 0xe0020...0xe007f]
    let keycapBases: Set<UInt32> = [0x23, 0x2a, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]
    let cps = text.unicodeScalars.map(\.value)
    var i = 0
    func next() -> UInt32? {
      defer { i += 1 }
      return i < cps.count ? cps[i] : nil
    }
    while true {
      guard let base = next() else { return nil }
      if within(base, regional) {
        guard within(next() ?? 0, regional) else { return nil }
      } else if keycapBases.contains(base) {
        while i < cps.count, cps[i] == 0xfe0f { i += 1 }
        guard next() == 0x20e3 else { return nil }
      } else if !within(base, pictographs) {
        return nil
      }
      while i < cps.count, within(cps[i], modifiers) { i += 1 }
      if i >= cps.count { return text }
      guard next() == 0x200d else { return nil }
    }
  }

  static func pinned(in scope: ScopeReplica) -> (pins: [SyncedPin], folders: [SyncedFolder]) {
    var tabs: [String: PinTab] = [:]
    var groups: [String: PinGroup] = [:]
    for (key, value) in scope.visible("pin:g:") {
      let id = String(key.dropFirst("pin:g:".count))
      groups[id] = PinGroup(id: id, name: value["n"]?.string ?? "", pos: value["pos"]?.string ?? "")
    }
    for (key, value) in scope.visible("pin:t:") {
      let id = String(key.dropFirst("pin:t:".count))
      let url = value["u"]?.string ?? ""
      let custom = value["t"]?.string ?? ""
      let page = value["ti"]?.string ?? ""
      let group = value["g"]?.string.flatMap { groups[$0] == nil ? nil : $0 }
      tabs[id] = PinTab(id: id, group: group, url: url, title: !custom.isEmpty ? custom : !page.isEmpty ? page : url, pos: value["pos"]?.string ?? "")
    }
    let rows = Set(scope.visible(SpaceKeys.pinRow).filter { $0.value.number == 1 }.keys.map { String($0.dropFirst(SpaceKeys.pinRow.count)) })
    let sortedTabs = { (list: [PinTab]) in list.sorted { byPosition(($0.id, $0.pos), ($1.id, $1.pos)) } }
    let standalone = tabs.values.filter { $0.group == nil }
    let tiles = sortedTabs(standalone.filter { !rows.contains($0.id) })
    let rowTabs = sortedTabs(standalone.filter { rows.contains($0.id) })
    var members: [String: [PinTab]] = [:]
    for tab in tabs.values { if let group = tab.group { members[group, default: []].append(tab) } }

    var out: [SyncedPin] = []
    var folders: [SyncedFolder] = []
    var at: (path: [String], id: String?) = ([], nil)
    func pin(_ tab: PinTab, groupId: String?, path: [String], isTile: Bool) -> SyncedPin {
      SyncedPin(id: "t:\(tab.id)", title: tab.title, url: tab.url.isEmpty ? nil : URL(string: tab.url), groupId: groupId, folderPath: path, isTile: isTile, folderId: isTile ? nil : at.id)
    }
    for tile in tiles { out.append(pin(tile, groupId: nil, path: [], isTile: true)) }

    var placed = Set<String>()
    func emitRow(_ id: String, _ path: [String]) {
      guard let tab = tabs[id], tab.group == nil, rows.contains(id), placed.insert("t:\(id)").inserted else { return }
      out.append(pin(tab, groupId: nil, path: path, isTile: false))
    }
    func emitGroup(_ id: String, _ path: [String]) {
      guard let group = groups[id], placed.insert("g:\(id)").inserted else { return }
      out.append(SyncedPin(id: "g:\(id)", title: group.name, url: nil, groupId: nil, folderPath: path, folderId: at.id))
      for member in sortedTabs(members[id] ?? []) { out.append(pin(member, groupId: "g:\(id)", path: path, isTile: false)) }
    }
    let tree = PinnedTree(records: scope.visible(SpaceKeys.pinFolder)) { ref in
      if let record = scope.records["pin:\(ref)"] { return record.v.isNull }
      return false
    }
    var looks: [String: (emoji: String?, color: String?)] = [:]
    for (key, value) in scope.visible(SpaceKeys.pinFolder + "a:") {
      let id = String(key.dropFirst((SpaceKeys.pinFolder + "a:").count))
      looks[id] = (folderEmoji(value["e"]?.string), value["c"]?.string.flatMap { folderColors.contains($0) ? $0 : nil })
    }
    var visited = Set<String>()
    func walk(_ refs: [String], _ path: [String]) {
      for ref in refs {
        if PinnedTree.isFolderRef(ref) {
          let id = PinnedTree.folderId(of: ref)
          guard let folder = tree.folders[id], visited.insert(id).inserted else { continue }
          let outer = at
          folders.append(SyncedFolder(id: ref, name: folder.name, path: path + [folder.name], parentId: outer.id, emoji: looks[id]?.emoji, color: looks[id]?.color))
          at = (path + [folder.name], ref)
          walk(folder.children, path + [folder.name])
          at = outer
        } else if ref.hasPrefix("t:") {
          emitRow(String(ref.dropFirst(2)), path)
        } else if ref.hasPrefix("g:") {
          emitGroup(String(ref.dropFirst(2)), path)
        }
      }
    }
    walk(tree.root, [])
    for row in rowTabs { emitRow(row.id, []) }
    for group in groups.values.sorted(by: { byPosition(($0.id, $0.pos), ($1.id, $1.pos)) }) { emitGroup(group.id, []) }
    return (out, folders)
  }
}
