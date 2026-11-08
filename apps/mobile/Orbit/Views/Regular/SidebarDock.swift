import OrbitSync
import SwiftUI
import UIKit

extension PinTree.Node {
  var isFolder: Bool {
    if case .folder = self { return true }
    return false
  }
}

enum DockPage: Hashable {
  case pins
  case folder(String)
}

struct DockItem: Identifiable {
  enum Kind {
    case pins
    case pin(SyncedPin)
    case folder(PinFolderInfo)
    case tab(BrowserTab)
    case separator
  }

  let id: String
  let kind: Kind

  var isSeparator: Bool {
    if case .separator = kind { return true }
    return false
  }

  var opensPage: DockPage? {
    switch kind {
    case .pins: .pins
    case .folder(let folder): .folder(folder.id)
    case .pin, .tab, .separator: nil
    }
  }

  static func pinItems(_ nodes: [PinTree.Node]) -> [DockItem] {
    nodes.flatMap { node -> [DockItem] in
      switch node {
      case .pin(let pin): [DockItem(id: "pin:\(pin.id)", kind: .pin(pin))]
      case .group(_, let members):
        members.filter { $0.url != nil }.map { DockItem(id: "pin:\($0.id)", kind: .pin($0)) }
      case .folder(let folder, _): [DockItem(id: "folder:\(folder.id)", kind: .folder(folder))]
      }
    }
  }

  static func items(of page: DockPage, in tree: PinTree) -> [DockItem]? {
    switch page {
    case .pins:
      return tree.tiles.map { DockItem(id: "pin:\($0.id)", kind: .pin($0)) } + pinItems(tree.roots.filter { !$0.isFolder })
    case .folder(let id):
      return folder(id, in: tree.roots).map { pinItems($0.children) }
    }
  }

  static func folder(_ id: String, in nodes: [PinTree.Node]) -> (info: PinFolderInfo, children: [PinTree.Node])? {
    for node in nodes {
      guard case .folder(let folder, let children) = node else { continue }
      if folder.id == id { return (folder, children) }
      if let found = Self.folder(id, in: children) { return found }
    }
    return nil
  }

  static func rootItems(tree: PinTree?, tabs: [DockItem]) -> [DockItem] {
    var top: [DockItem] = []
    if let tree {
      if !(items(of: .pins, in: tree) ?? []).isEmpty { top.append(DockItem(id: "pins", kind: .pins)) }
      top += pinItems(tree.roots.filter(\.isFolder))
    }
    if top.isEmpty || tabs.isEmpty { return top + tabs }
    return top + [DockItem(id: "separator", kind: .separator)] + tabs
  }

  @MainActor static func items(of page: DockPage?, in browser: BrowserModel) -> [DockItem]? {
    let tree = browser.currentSpace.map { PinTree(space: $0) }
    guard let page else {
      return rootItems(tree: tree, tabs: browser.tabs.reversed().map { DockItem(id: "tab:\($0.id)", kind: .tab($0)) })
    }
    return tree.flatMap { items(of: page, in: $0) }
  }
}

struct DockMagnification {
  static let maximumTile: CGFloat = 52
  static let minimumTile: CGFloat = 40
  static let visibleIcons: CGFloat = 12
  static let spacing: CGFloat = 8
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

  init(separators: [Bool], viewportHeight: CGFloat) {
    self.separators = separators
    let fitting = (viewportHeight - Self.padding * 2 - Self.spacing * (Self.visibleIcons - 1)) / Self.visibleIcons
    tile = min(Self.maximumTile, max(Self.minimumTile, fitting.rounded(.down)))
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
  static let width: CGFloat = 72
  static let turnDuration: TimeInterval = 0.32

  @Environment(BrowserModel.self) private var browser
  let safeArea: EdgeInsets
  let edgeGap: CGFloat
  @State private var topRow = TopRowGeometry()
  @State private var path: [DockPage] = []
  @State private var forward = true
  @State private var turning = false

  var body: some View {
    let page = path.last
    let items = DockItem.items(of: page, in: browser)
    let center = safeArea.leading + Self.width / 2
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        SidebarIconButton(systemImage: "sidebar.left", label: "Hide Sidebar") { browser.isSidebarVisible = false }
        Spacer(minLength: 0)
      }
      .padding(.leading, center - SidebarLayout.iconButtonSize / 2)
      .padding(.top, SidebarLayout.topRowInset(edgeGap: edgeGap, statusBarOverlap: topRow.statusBarOverlap))
      .background { LayoutRegionInsetsReader { topRow = $0 } }
      if page != nil {
        SidebarIconButton(systemImage: "chevron.up", label: "Close Folder") { back() }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, center - SidebarLayout.iconButtonSize / 2)
          .padding(.top, 6)
          .transition(.opacity)
      }
      ZStack(alignment: .top) {
        DockPageView(items: items ?? [], page: page, leading: safeArea.leading, open: open)
          .id(page)
          .transition(
            forward
              ? .asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading))
              : .asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .trailing)))
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .mask { Rectangle().padding(.trailing, turning ? 0 : -640) }
      .padding(.vertical, 6)
      .zIndex(1)
      DockBackButton(size: ChromeMetrics.regularControlSize)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.leading, center - ChromeMetrics.regularControlSize / 2)
      .padding(.bottom, edgeGap)
    }
    .onChange(of: items == nil) { _, missing in
      if missing { path = [] }
    }
    .onChange(of: browser.currentSpace?.id) { _, _ in path = [] }
    .sensoryFeedback(.impact(weight: .light), trigger: path)
  }

  private func open(_ item: DockItem) {
    if let next = item.opensPage {
      turn(forward: true) { path.append(next) }
      return
    }
    switch item.kind {
    case .pin(let pin): browser.openPin(pin)
    case .tab(let tab): browser.select(tab)
    case .pins, .folder, .separator: break
    }
  }

  private func back() {
    guard !path.isEmpty else { return }
    turn(forward: false) { _ = path.popLast() }
  }

  private func turn(forward: Bool, _ change: () -> Void) {
    self.forward = forward
    turning = true
    withAnimation(.smooth(duration: Self.turnDuration)) { change() } completion: { turning = false }
  }
}

struct DockBackButton: View {
  @Environment(BrowserModel.self) private var browser
  let size: CGFloat

  var body: some View {
    let tab = browser.selectedTab
    let canGoBack = tab?.canGoBack == true
    GlassCircleButton(systemImage: "chevron.backward", label: "Back", size: size) { browser.goBack() }
      .disabled(!canGoBack)
      .opacity(canGoBack ? 1 : 0.45)
      .contextMenu {
        Button("Forward", systemImage: "chevron.forward") { browser.goForward() }
          .disabled(tab?.canGoForward != true)
        Button("Reload", systemImage: "arrow.clockwise") { browser.reloadOrStop() }
          .disabled(tab?.url == nil)
      }
  }
}

struct DockPageView: View {
  @Environment(BrowserModel.self) private var browser
  let items: [DockItem]
  let page: DockPage?
  let leading: CGFloat
  let open: (DockItem) -> Void
  @State private var focus: CGFloat?
  @State private var magnifying = false
  @State private var holding = false
  @State private var offset: CGFloat = 0
  @State private var heldUntil = Date.distantPast

  var body: some View {
    GeometryReader { proxy in
      let dock = DockMagnification(separators: items.map(\.isSeparator), viewportHeight: proxy.size.height)
      let tileLeading = leading + (SidebarDock.width - dock.tile) / 2
      let focused = focus.flatMap { dock.index(at: $0) }
      ScrollView {
        DockStrip(
          items: items, placements: dock.rest, tile: dock.tile, tileLeading: tileLeading, dotX: leading + 4,
          isSelected: isSelected)
          .frame(width: proxy.size.width, height: dock.restHeight, alignment: .topLeading)
          .opacity(magnifying ? 0 : 1)
          .contentShape(.rect)
          .onTapGesture { location in
            guard Date() > heldUntil, let index = dock.index(at: location.y) else { return }
            open(items[index])
          }
          .gesture(
            DockHoldGesture { state, location in
              hold(state, at: location, dock: dock, width: proxy.size.width)
            }
          )
          .onContinuousHover { phase in
            guard !holding else { return }
            switch phase {
            case .active(let point): magnify(to: point.y)
            case .ended: settle()
            }
          }
      }
      .scrollIndicators(.hidden)
      .scrollDisabled(holding)
      .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, value in
        offset = value
      }
      .overlay(alignment: .topLeading) {
        if magnifying {
          DockMagnifier(
            items: items, placements: dock.layout(focus: focus), tile: dock.tile, focused: focused, offset: offset,
            tileLeading: tileLeading, dotX: leading + 4, title: title, isSelected: isSelected)
          .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
          .mask { Rectangle().padding(.trailing, -640) }
          .allowsHitTesting(false)
        }
      }
      .sensoryFeedback(.selection, trigger: holding ? focused : nil)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(pageTitle)
      .accessibilityActions {
        ForEach(items.filter { !$0.isSeparator }) { item in
          Button(title(item)) { open(item) }
        }
      }
    }
  }

  private var pageTitle: String {
    switch page {
    case nil: "Tabs"
    case .pins: "Pinned"
    case .folder(let id): browser.currentSpace.flatMap { DockItem.folder(id, in: PinTree(space: $0).roots)?.info.name } ?? "Folder"
    }
  }

  private func hold(_ state: UIGestureRecognizer.State, at location: CGPoint, dock: DockMagnification, width: CGFloat) {
    switch state {
    case .began:
      holding = true
      magnify(to: location.y)
    case .changed:
      magnify(to: location.y)
    case .ended:
      heldUntil = Date().addingTimeInterval(0.3)
      holding = false
      let index = dock.index(at: location.y)
      settle()
      if let index, location.x <= width + 160 { open(items[index]) }
    default:
      heldUntil = Date().addingTimeInterval(0.3)
      holding = false
      settle()
    }
  }

  private func magnify(to y: CGFloat) {
    if !magnifying {
      magnifying = true
      Task { @MainActor in withAnimation(.smooth(duration: 0.16)) { focus = y } }
      return
    }
    withAnimation(.smooth(duration: 0.12)) { focus = y }
  }

  private func settle() {
    guard magnifying else { return }
    withAnimation(.smooth(duration: 0.18)) { focus = nil } completion: {
      if focus == nil, !holding { magnifying = false }
    }
  }

  private func isSelected(_ item: DockItem) -> Bool {
    switch item.kind {
    case .pin(let pin): browser.isPinSelected(pin)
    case .tab(let tab): tab.id == browser.selectedTabID
    case .pins, .folder, .separator: false
    }
  }

  private func title(_ item: DockItem) -> String {
    switch item.kind {
    case .pins: return "Pinned"
    case .pin(let pin):
      let tab = browser.pinTab(for: pin)
      return tab.map { $0.title.isEmpty ? pin.title : $0.title } ?? pin.title
    case .tab(let tab): return tab.displayTitle
    case .folder(let folder): return folder.name
    case .separator: return ""
    }
  }
}

struct DockStrip: View {
  let items: [DockItem]
  let placements: [DockMagnification.Placement]
  let tile: CGFloat
  let tileLeading: CGFloat
  let dotX: CGFloat
  let isSelected: (DockItem) -> Bool
  var offset: CGFloat = 0

  var body: some View {
    ZStack(alignment: .topLeading) {
      ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
        let place = placements[index]
        let y = place.center - offset
        if item.isSeparator {
          Capsule()
            .fill(.secondary.opacity(0.45))
            .frame(width: tile * 0.7, height: 1)
            .position(x: tileLeading + tile / 2, y: y)
        } else {
          DockTile(item: item, size: place.size)
            .position(x: tileLeading + place.size / 2, y: y)
          if isSelected(item) {
            Circle()
              .fill(.primary.opacity(0.7))
              .frame(width: 4, height: 4)
              .position(x: dotX, y: y)
          }
        }
      }
    }
  }
}

struct DockMagnifier: View {
  let items: [DockItem]
  let placements: [DockMagnification.Placement]
  let tile: CGFloat
  let focused: Int?
  let offset: CGFloat
  let tileLeading: CGFloat
  let dotX: CGFloat
  let title: (DockItem) -> String
  let isSelected: (DockItem) -> Bool

  var body: some View {
    ZStack(alignment: .topLeading) {
      DockStrip(
        items: items, placements: placements, tile: tile, tileLeading: tileLeading, dotX: dotX, isSelected: isSelected,
        offset: offset)
      if let focused, placements.indices.contains(focused) {
        DockTitleBubble(title: title(items[focused]))
          .fixedSize()
          .alignmentGuide(.leading) { _ in -(tileLeading + placements[focused].size + 12) }
          .alignmentGuide(.top) { dimensions in -(placements[focused].center - offset - dimensions.height / 2) }
          .transition(.opacity)
      }
    }
  }
}

struct DockHoldGesture: UIGestureRecognizerRepresentable {
  static let pressDuration: TimeInterval = 0.22
  let onChange: (UIGestureRecognizer.State, CGPoint) -> Void

  func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
    let recognizer = UILongPressGestureRecognizer()
    recognizer.minimumPressDuration = Self.pressDuration
    recognizer.allowableMovement = 12
    return recognizer
  }

  func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
    onChange(recognizer.state, context.converter.localLocation)
  }
}

struct DockTile: View {
  @Environment(BrowserModel.self) private var browser
  let item: DockItem
  let size: CGFloat

  var body: some View {
    Group {
      switch item.kind {
      case .pins: DockSymbolIcon(systemImage: "pin.fill", tint: .orange, size: size)
      case .pin(let pin): DockSiteIcon(url: browser.pinTab(for: pin)?.url ?? pin.url, size: size)
      case .tab(let tab): DockSiteIcon(url: tab.url, size: size)
      case .folder(let folder): DockFolderIcon(folder: folder, size: size)
      case .separator: EmptyView()
      }
    }
    .frame(width: size, height: size)
    .shadow(color: .black.opacity(0.16), radius: size * 0.06, y: size * 0.03)
  }
}

struct DockSymbolIcon: View {
  let systemImage: String
  let tint: Color
  let size: CGFloat

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
    ZStack {
      shape.fill(tint.opacity(0.22))
      Image(systemName: systemImage)
        .font(.system(size: size * 0.42, weight: .semibold))
        .foregroundStyle(tint)
        .rotationEffect(.degrees(45))
    }
    .overlay(shape.strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
  }
}

struct DockSiteIcon: View {
  let url: URL?
  let size: CGFloat
  @State private var icon: UIImage?
  @State private var settled: Bool

  init(url: URL?, size: CGFloat) {
    self.url = url
    self.size = size
    let known = SiteIconMemory.lookup(url)
    _icon = State(initialValue: known ?? nil)
    _settled = State(initialValue: known != nil)
  }

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
      if let known = SiteIconMemory.lookup(url) {
        icon = known
        settled = true
        return
      }
      settled = false
      let loaded = await SiteIconLoader.shared.icon(for: url)
      SiteIconMemory.remember(loaded, for: url)
      icon = loaded
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
  let size: CGFloat

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
    ZStack {
      shape.fill((folder.tint ?? .secondary).opacity(0.24))
      if let emoji = folder.emoji, !emoji.isEmpty {
        Text(emoji).font(.system(size: size * 0.5))
      } else {
        Image(systemName: "folder.fill")
          .font(.system(size: size * 0.42, weight: .medium))
          .foregroundStyle(folder.tint ?? .secondary)
      }
    }
    .overlay(shape.strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
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
