import OrbitSync

struct PinLayout {
  enum Entry: Identifiable {
    case pin(SyncedPin)
    case group(SyncedPin, members: [SyncedPin])

    var id: String {
      switch self {
      case .pin(let pin): pin.id
      case .group(let group, _): group.id
      }
    }
  }

  struct Section: Identifiable {
    let path: [String]
    var entries: [Entry]

    var id: String { path.joined(separator: "/") }
    var title: String { path.joined(separator: " › ") }
  }

  let tiles: [SyncedPin]
  let sections: [Section]

  var isEmpty: Bool { tiles.isEmpty && sections.isEmpty }

  init(pins: [SyncedPin]) {
    var tiles: [SyncedPin] = []
    var sections: [Section] = []
    var sectionIndex: [[String]: Int] = [:]
    var groupLocation: [String: (section: Int, entry: Int)] = [:]

    func section(for path: [String]) -> Int {
      if let index = sectionIndex[path] { return index }
      sections.append(Section(path: path, entries: []))
      sectionIndex[path] = sections.count - 1
      return sections.count - 1
    }

    for pin in pins {
      if pin.isTile {
        if pin.url != nil { tiles.append(pin) }
        continue
      }
      if pin.url == nil {
        let index = section(for: pin.folderPath)
        sections[index].entries.append(.group(pin, members: []))
        groupLocation[pin.id] = (index, sections[index].entries.count - 1)
        continue
      }
      if let groupId = pin.groupId, let location = groupLocation[groupId],
        case .group(let group, let members) = sections[location.section].entries[location.entry]
      {
        sections[location.section].entries[location.entry] = .group(group, members: members + [pin])
        continue
      }
      sections[section(for: pin.folderPath)].entries.append(.pin(pin))
    }

    self.tiles = tiles
    let root = sections.filter { $0.path.isEmpty }
    self.sections = root + sections.filter { !$0.path.isEmpty }
  }
}
