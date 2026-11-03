import OrbitSync
import SwiftUI

struct DockItem: Identifiable {
  enum Kind {
    case pin(SyncedPin)
    case folder(PinFolderInfo, expanded: Bool)
    case tab(BrowserTab)
    case separator
  }

  let id: String
  let kind: Kind

  var isSeparator: Bool {
    if case .separator = kind { return true }
    return false
  }

  @MainActor static func items(in browser: BrowserModel) -> [DockItem] {
    var pins: [DockItem] = []
    if let space = browser.currentSpace {
      let tree = PinTree(space: space)
      pins += tree.tiles.filter { $0.url != nil }.map { DockItem(id: "pin:\($0.id)", kind: .pin($0)) }
      func add(_ nodes: [PinTree.Node]) {
        for node in nodes {
          switch node {
          case .pin(let pin):
            if pin.url != nil { pins.append(DockItem(id: "pin:\(pin.id)", kind: .pin(pin))) }
          case .group(_, let members):
            pins += members.filter { $0.url != nil }.map { DockItem(id: "pin:\($0.id)", kind: .pin($0)) }
          case .folder(let folder, let children):
            let expanded = browser.pinFolders.isExpanded(folder.id)
            pins.append(DockItem(id: "folder:\(folder.id)", kind: .folder(folder, expanded: expanded)))
            if expanded { add(children) }
          }
        }
      }
      add(tree.roots)
    }
    let tabs = browser.tabs.reversed().map { DockItem(id: "tab:\($0.id)", kind: .tab($0)) }
    if pins.isEmpty || tabs.isEmpty { return pins + tabs }
    return pins + [DockItem(id: "separator", kind: .separator)] + tabs
  }
}

struct DockMagnification {
  static let restTile: CGFloat = 44
  static let minimumTile: CGFloat = 20
  static let spacing: CGFloat = 6
  static let separatorHeight: CGFloat = 9
  static let padding: CGFloat = 8
  static let peakSize: CGFloat = 68
  static let peakScale: CGFloat = 1.5
  static let reachSlots: CGFloat = 2.6
  static let reachOfPeak: CGFloat = 1.5

  struct Placement: Equatable {
    var center: CGFloat
    var size: CGFloat
  }

  let separators: [Bool]
  let tile: CGFloat

  init(separators: [Bool], availableHeight: CGFloat) {
    self.separators = separators
    let icons = separators.filter { !$0 }.count
    let fixed = Self.padding * 2 + CGFloat(separators.count - icons) * Self.separatorHeight
      + Self.spacing * CGFloat(max(0, separators.count - 1))
    let fitting = icons > 0 ? (availableHeight - fixed) / CGFloat(icons) : Self.restTile
    tile = min(Self.restTile, max(Self.minimumTile, fitting.rounded(.down)))
  }

  var peak: CGFloat { max(Self.peakSize, tile * Self.peakScale) }

  var reach: CGFloat { max(Self.reachSlots * (tile + Self.spacing), Self.reachOfPeak * peak) }

  var restHeight: CGFloat {
    guard let last = rest.last else { return Self.padding * 2 }
    return last.center + last.size / 2 + Self.padding
  }

  var rest: [Placement] { placements(sizes: separators.map { $0 ? Self.separatorHeight : tile }) }

  func size(at distance: CGFloat) -> CGFloat {
    let reach = reach
    guard abs(distance) < reach else { return tile }
    return tile + (peak - tile) * (1 + cos(.pi * abs(distance) / reach)) / 2
  }

  func layout(focus: CGFloat?) -> [Placement] {
    let rest = rest
    guard let focus, !rest.isEmpty else { return rest }
    let sizes = zip(rest, separators).map { place, isSeparator in
      isSeparator ? place.size : size(at: place.center - focus)
    }
    let grown = placements(sizes: sizes)
    let shift = focus - mapped(focus, from: rest, to: grown)
    return grown.map { Placement(center: $0.center + shift, size: $0.size) }
  }

  func index(at y: CGFloat) -> Int? {
    let rest = rest
    guard !rest.isEmpty, y >= -Self.spacing, y <= restHeight + Self.spacing else { return nil }
    let candidates = rest.indices.filter { !separators[$0] }
    return candidates.min { abs(rest[$0].center - y) < abs(rest[$1].center - y) }
  }

  private func placements(sizes: [CGFloat]) -> [Placement] {
    var y = Self.padding
    return sizes.map { size in
      defer { y += size + Self.spacing }
      return Placement(center: y + size / 2, size: size)
    }
  }

  private func mapped(_ y: CGFloat, from rest: [Placement], to grown: [Placement]) -> CGFloat {
    guard let first = rest.first, let last = rest.last else { return y }
    if y <= first.center { return grown[0].center - (first.center - y) * grown[0].size / first.size }
    if y >= last.center { return grown[grown.count - 1].center + (y - last.center) * grown[grown.count - 1].size / last.size }
    let next = rest.firstIndex { $0.center >= y } ?? rest.count - 1
    let previous = next - 1
    let span = rest[next].center - rest[previous].center
    let t = span > 0 ? (y - rest[previous].center) / span : 0
    return grown[previous].center + t * (grown[next].center - grown[previous].center)
  }
}

struct SidebarDock: View {
  static let shelfInset: CGFloat = 6
  static let shelfWidth = DockMagnification.restTile + DockMagnification.padding * 2

  @Environment(BrowserModel.self) private var browser
  let safeArea: EdgeInsets
  let edgeGap: CGFloat
  @State private var topRow = TopRowGeometry()

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        SidebarIconButton(systemImage: "sidebar.left", label: "Hide Sidebar") { browser.isSidebarVisible = false }
        Spacer(minLength: 0)
      }
      .padding(.leading, safeArea.leading + Self.shelfInset + (Self.shelfWidth - SidebarLayout.iconButtonSize) / 2)
      .padding(.top, SidebarLayout.topRowInset(edgeGap: edgeGap, statusBarOverlap: topRow.statusBarOverlap))
      .background { LayoutRegionInsetsReader { topRow = $0 } }
      DockShelf(items: DockItem.items(in: browser), leading: safeArea.leading + Self.shelfInset)
        .padding(.vertical, 10)
        .zIndex(1)
      GlassCircleButton(systemImage: "square.grid.2x2", label: "All Tabs", size: ChromeMetrics.regularControlSize) {
        browser.showTabSwitcher()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.leading, safeArea.leading + Self.shelfInset + (Self.shelfWidth - ChromeMetrics.regularControlSize) / 2)
      .padding(.bottom, edgeGap)
    }
  }
}

struct DockShelf: View {
  @Environment(BrowserModel.self) private var browser
  let items: [DockItem]
  let leading: CGFloat
  @State private var touch: CGPoint?
  @State private var hover: CGPoint?

  var body: some View {
    GeometryReader { proxy in
      let dock = DockMagnification(separators: items.map(\.isSeparator), availableHeight: proxy.size.height)
      let restTop = max(0, (proxy.size.height - dock.restHeight) / 2)
      let pointer = touch ?? hover
      let focusY = pointer.map { $0.y - restTop }
      let placements = dock.layout(focus: focusY)
      let focused = focusY.flatMap { dock.index(at: $0) }
      let tileLeading = leading + DockMagnification.padding + (DockMagnification.restTile - dock.tile) / 2
      ZStack(alignment: .topLeading) {
        shelf(placements: placements, restTop: restTop)
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
          let place = placements[index]
          if item.isSeparator {
            Capsule()
              .fill(.secondary.opacity(0.45))
              .frame(width: dock.tile * 0.7, height: 1)
              .position(x: tileLeading + dock.tile / 2, y: restTop + place.center)
          } else {
            DockTile(item: item, size: place.size)
              .position(x: tileLeading + place.size / 2, y: restTop + place.center)
            if isSelected(item) {
              Circle()
                .fill(.primary.opacity(0.7))
                .frame(width: 4, height: 4)
                .position(x: leading + 3.5, y: restTop + place.center)
            }
          }
        }
        if let focused, pointer != nil {
          DockTitleBubble(title: title(of: items[focused]))
            .fixedSize()
            .alignmentGuide(.leading) { _ in -(tileLeading + placements[focused].size + 12) }
            .alignmentGuide(.top) { dimensions in -(restTop + placements[focused].center - dimensions.height / 2) }
            .transition(.opacity)
            .allowsHitTesting(false)
        }
      }
      .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
      .contentShape(.rect)
      .animation(.smooth(duration: 0.16), value: pointer)
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in touch = value.location }
          .onEnded { value in
            let index = dock.index(at: value.location.y - restTop)
            touch = nil
            guard let index, value.location.x <= proxy.size.width + 160 else { return }
            activate(items[index])
          }
      )
      .onContinuousHover { phase in
        switch phase {
        case .active(let point): hover = point.x <= proxy.size.width ? point : nil
        case .ended: hover = nil
        }
      }
      .sensoryFeedback(.selection, trigger: touch == nil ? nil : focused)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Tabs")
      .accessibilityValue(items.filter(isSelected).first.map(title) ?? "")
      .accessibilityActions {
        ForEach(items.filter { !$0.isSeparator }) { item in
          Button(title(of: item)) { activate(item) }
        }
      }
    }
  }

  private func shelf(placements: [DockMagnification.Placement], restTop: CGFloat) -> some View {
    let top = (placements.first.map { $0.center - $0.size / 2 } ?? 0) - DockMagnification.padding
    let bottom = (placements.last.map { $0.center + $0.size / 2 } ?? 0) + DockMagnification.padding
    return Color.clear
      .frame(width: SidebarDock.shelfWidth, height: max(0, bottom - top))
      .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
      .offset(x: leading, y: restTop + top)
      .opacity(placements.isEmpty ? 0 : 1)
  }

  private func isSelected(_ item: DockItem) -> Bool {
    switch item.kind {
    case .pin(let pin): browser.isPinSelected(pin)
    case .tab(let tab): tab.id == browser.selectedTabID
    case .folder, .separator: false
    }
  }

  private func title(of item: DockItem) -> String {
    switch item.kind {
    case .pin(let pin):
      let tab = browser.pinTab(for: pin)
      return tab.map { $0.title.isEmpty ? pin.title : $0.title } ?? pin.title
    case .tab(let tab): return tab.displayTitle
    case .folder(let folder, _): return folder.name
    case .separator: return ""
    }
  }

  private func activate(_ item: DockItem) {
    switch item.kind {
    case .pin(let pin): browser.openPin(pin)
    case .tab(let tab): browser.select(tab)
    case .folder(let folder, _): withAnimation(.snappy) { browser.pinFolders.toggle(folder.id) }
    case .separator: break
    }
  }
}

struct DockTile: View {
  @Environment(BrowserModel.self) private var browser
  let item: DockItem
  let size: CGFloat

  var body: some View {
    Group {
      switch item.kind {
      case .pin(let pin): DockSiteIcon(url: browser.pinTab(for: pin)?.url ?? pin.url, size: size)
      case .tab(let tab): DockSiteIcon(url: tab.url, size: size)
      case .folder(let folder, let expanded): DockFolderIcon(folder: folder, expanded: expanded, size: size)
      case .separator: EmptyView()
      }
    }
    .frame(width: size, height: size)
    .shadow(color: .black.opacity(0.18), radius: size * 0.06, y: size * 0.03)
  }
}

struct DockSiteIcon: View {
  let url: URL?
  let size: CGFloat
  @State private var icon: UIImage?
  @State private var settled = false

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
    ZStack {
      Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
      if let icon {
        if Self.fillsTile(icon) {
          Image(uiImage: icon).resizable().interpolation(.high).scaledToFill()
        } else {
          Image(uiImage: icon).resizable().interpolation(.high).scaledToFit().frame(width: size * 0.58, height: size * 0.58)
        }
      } else if settled {
        Text(Self.monogram(for: url))
          .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
          .foregroundStyle(.secondary)
      }
    }
    .frame(width: size, height: size)
    .clipShape(shape)
    .overlay(shape.strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
    .task(id: SiteIconLinks.origin(of: url)) {
      settled = false
      icon = await SiteIconLoader.shared.icon(for: url)
      settled = true
    }
  }

  static func fillsTile(_ image: UIImage) -> Bool {
    image.size.width * image.scale >= 120
  }

  static func monogram(for url: URL?) -> String {
    guard let host = url?.host()?.lowercased() else { return "•" }
    let name = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    return name.first.map { String($0).uppercased() } ?? "•"
  }
}

struct DockFolderIcon: View {
  let folder: PinFolderInfo
  let expanded: Bool
  let size: CGFloat

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
    ZStack {
      shape.fill((folder.tint ?? .secondary).opacity(0.28))
      if let emoji = folder.emoji, !emoji.isEmpty {
        Text(emoji).font(.system(size: size * 0.5))
      } else {
        Image(systemName: expanded ? "folder" : "folder.fill")
          .font(.system(size: size * 0.42, weight: .medium))
          .foregroundStyle(folder.tint ?? .secondary)
      }
    }
    .overlay(alignment: .bottomTrailing) {
      Image(systemName: expanded ? "chevron.up" : "chevron.down")
        .font(.system(size: max(7, size * 0.2), weight: .bold))
        .foregroundStyle(.secondary)
        .padding(size * 0.08)
    }
  }
}

struct DockTitleBubble: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 14, weight: .medium))
      .lineLimit(1)
      .frame(maxWidth: 320)
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
      .background(.thickMaterial, in: .rect(cornerRadius: 10, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.primary.opacity(0.1), lineWidth: 0.5))
      .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
  }
}
