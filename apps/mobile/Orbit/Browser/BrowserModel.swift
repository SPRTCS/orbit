import OrbitSync
import SwiftUI
import WebKit

@Observable
final class BrowserModel {
  static let maxLiveWebViews = 6

  private(set) var tabs: [BrowserTab] = []
  private(set) var selectedTabID: UUID?
  var chromeCollapsed = false
  var isShowingTabSwitcher = false {
    didSet {
      if !isShowingTabSwitcher, oldValue { morph.cardFrames.removeAll() }
    }
  }
  var isShowingDevices = false
  var isShowingSettings = false
  var isShowingSyncSetup = false
  var isSidebarVisible = true
  var selectedSpaceID: String?

  let entry = AddressEntryModel()
  let morph = OverviewMorph()
  @ObservationIgnored var isCompactLayout = true
  let suggestions = SuggestionEngine()
  let history: HistoryStore
  let settings: AppSettings
  let sync: SyncCoordinator

  @ObservationIgnored let persistence: TabPersistence
  @ObservationIgnored let factory = WebViewFactory()
  @ObservationIgnored private var saveTask: Task<Void, Never>?
  @ObservationIgnored private var recentlyClosed: [TabRecord] = []
  @ObservationIgnored private var memoryWarningObserver: NSObjectProtocol?
  @ObservationIgnored private var keyboardObservers: [NSObjectProtocol] = []
  @ObservationIgnored private(set) var isKeyboardVisible = false

  init(
    persistence: TabPersistence = .standard(), settings: AppSettings = AppSettings(),
    syncClient: any OrbitSyncing = SyncProvider.makeClient()
  ) {
    self.persistence = persistence
    self.settings = settings
    self.history = HistoryStore(persistence: persistence)
    self.sync = SyncCoordinator(client: syncClient)
    if let name = settings.deviceName, !name.isEmpty, let editable = syncClient as? DeviceNameEditable {
      editable.thisDeviceName = name
    }
    restoreSession()
    factory.schedulePrewarm(after: .seconds(1))
    memoryWarningObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.unloadBackgroundTabs() }
    }
    keyboardObservers = [
      NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated { self?.keyboardVisibilityChanged(true) }
      },
      NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated { self?.keyboardVisibilityChanged(false) }
      },
    ]
  }

  private func keyboardVisibilityChanged(_ visible: Bool) {
    isKeyboardVisible = visible
    if visible { setChromeCollapsed(false) }
  }

  var selectedTab: BrowserTab? {
    guard let selectedTabID else { return nil }
    return tabs.first { $0.id == selectedTabID }
  }

  var currentSpace: SyncedSpace? {
    let spaces = sync.client.spaces
    if let selectedSpaceID, let space = spaces.first(where: { $0.id == selectedSpaceID }) { return space }
    return sync.defaultSpace
  }

  private func restoreSession() {
    let session = persistence.loadSession()
    tabs = session.tabs.map(BrowserTab.init(record:))
    persistence.pruneArtifacts(keeping: Set(tabs.map(\.id)))
    let restored = tabs.first { $0.id == session.selectedID } ?? tabs.max { $0.lastActive < $1.lastActive }
    if let restored {
      activate(restored, touch: false)
    } else {
      entry.begin(newTab: true, initialText: "")
      tabsChanged()
    }
  }

  private func activate(_ tab: BrowserTab, touch: Bool = true) {
    selectedTabID = tab.id
    if touch { tab.lastActive = .now }
    if tab.url != nil || tab.controller != nil { ensureLive(tab) }
    enforceLiveLimit()
    tabsChanged()
  }

  @discardableResult
  func ensureLive(_ tab: BrowserTab) -> WKWebView {
    if let webView = tab.webView { return webView }
    let webView = factory.makeWebView()
    tab.controller = TabWebController(webView: webView, tab: tab, browser: self)
    if let state = persistence.interactionState(for: tab.id) {
      webView.interactionState = state
    } else if let url = tab.url {
      webView.load(URLRequest(url: url))
    }
    return webView
  }

  private func enforceLiveLimit() {
    let background = tabs.filter { $0.controller != nil && $0.id != selectedTabID }
      .sorted { $0.lastActive > $1.lastActive }
    for tab in background.dropFirst(Self.maxLiveWebViews - 1) { unload(tab) }
  }

  private func unload(_ tab: BrowserTab) {
    guard let controller = tab.controller else { return }
    persistence.saveInteractionState(controller.webView.interactionState as? Data, for: tab.id)
    controller.tearDown()
    tab.controller = nil
    tab.isLoading = false
    tab.progress = 0
  }

  func unloadBackgroundTabs() {
    for tab in tabs where tab.id != selectedTabID { unload(tab) }
    factory.dropSpare()
  }

  func select(_ tab: BrowserTab) {
    select(tab, keepingOverview: false)
  }

  private func select(_ tab: BrowserTab, keepingOverview: Bool) {
    if let current = selectedTab, current.id != tab.id { captureSnapshot(of: current) }
    activate(tab)
    if !keepingOverview { isShowingTabSwitcher = false }
    setChromeCollapsed(false)
  }

  func select(tabID: UUID) {
    if let tab = tabs.first(where: { $0.id == tabID }) { select(tab) }
  }

  func selectAdjacent(_ offset: Int, wrap: Bool) {
    guard let current = selectedTab, let index = tabs.firstIndex(where: { $0.id == current.id }) else { return }
    var target = index + offset
    if wrap {
      target = (target % tabs.count + tabs.count) % tabs.count
    } else {
      guard tabs.indices.contains(target) else { return }
    }
    if target != index { select(tabs[target]) }
  }

  var hasNextTab: Bool {
    guard let id = selectedTabID, let index = tabs.firstIndex(where: { $0.id == id }) else { return false }
    return index < tabs.count - 1
  }

  @discardableResult
  func openNewTab(with url: URL?, select shouldSelect: Bool = true) -> BrowserTab {
    let tab = BrowserTab(url: url)
    tabs.append(tab)
    if shouldSelect {
      select(tab)
    } else {
      tab.lastActive = .now.addingTimeInterval(-1)
      tabsChanged()
    }
    return tab
  }

  func openInBackground(_ url: URL) {
    openNewTab(with: url, select: false)
  }

  func open(_ url: URL, inNewTab: Bool, preferExisting: Bool = false) {
    if preferExisting {
      let key = Omnibox.matchKey(url)
      if let existing = tabs.first(where: { $0.url.map(Omnibox.matchKey) == key }) {
        select(existing)
        return
      }
    }
    if inNewTab || selectedTab == nil {
      openNewTab(with: url)
    } else if let tab = selectedTab {
      load(url, in: tab)
    }
  }

  func openSynced(_ url: URL) {
    isShowingDevices = false
    open(url, inNewTab: true, preferExisting: true)
    isShowingTabSwitcher = false
  }

  func load(_ url: URL, in tab: BrowserTab) {
    tab.loadError = nil
    tab.url = url
    if let webView = tab.webView {
      webView.load(URLRequest(url: url))
    } else {
      ensureLive(tab).load(URLRequest(url: url))
    }
    setChromeCollapsed(false)
    tabsChanged()
  }

  func openPopup(configuration: WKWebViewConfiguration) -> WKWebView {
    let tab = BrowserTab(url: nil)
    let webView = factory.makeWebView(configuration: configuration)
    tab.controller = TabWebController(webView: webView, tab: tab, browser: self)
    tabs.append(tab)
    select(tab)
    return webView
  }

  func close(_ tab: BrowserTab) {
    guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
    if tab.url != nil {
      recentlyClosed.append(tab.record)
      if recentlyClosed.count > 20 { recentlyClosed.removeFirst() }
    }
    tab.controller?.tearDown()
    tab.controller = nil
    tabs.remove(at: index)
    persistence.removeArtifacts(for: tab.id)
    if selectedTabID == tab.id {
      selectedTabID = nil
      if let next = tabs.max(by: { $0.lastActive < $1.lastActive }) { activate(next) }
    }
    tabsChanged()
  }

  func closeSelectedTab() {
    if let selectedTab { close(selectedTab) }
  }

  func closeAllTabs() {
    for tab in tabs {
      tab.controller?.tearDown()
      tab.controller = nil
      persistence.removeArtifacts(for: tab.id)
    }
    tabs.removeAll()
    selectedTabID = nil
    tabsChanged()
  }

  func reopenClosedTab() {
    guard let record = recentlyClosed.popLast(), let url = record.url else { return }
    openNewTab(with: url)
  }

  func goBack() { selectedTab?.webView?.goBack() }
  func goForward() { selectedTab?.webView?.goForward() }

  func reload() {
    guard let tab = selectedTab else { return }
    if tab.loadError != nil, let failed = tab.failedURL {
      load(failed, in: tab)
    } else if let webView = tab.webView {
      webView.reload()
    }
  }

  func stopLoading() { selectedTab?.webView?.stopLoading() }

  func reloadOrStop() {
    if selectedTab?.isLoading == true { stopLoading() } else { reload() }
  }

  static let chromeAnimation: Animation = .spring(response: 0.42, dampingFraction: 0.84)

  func setChromeCollapsed(_ collapsed: Bool) {
    let target = collapsed && !entry.isPresented && !isKeyboardVisible && !isShowingTabSwitcher
    guard chromeCollapsed != target else { return }
    withAnimation(Self.chromeAnimation) { chromeCollapsed = target }
  }

  var usesOverviewMorph: Bool {
    !UIAccessibility.isReduceMotionEnabled
  }

  func showTabSwitcher() {
    entry.dismiss()
    setChromeCollapsed(false)
    guard !isShowingTabSwitcher, !morph.isActive else { return }
    guard usesOverviewMorph, let tab = selectedTab, tab.webView != nil else {
      if let tab = selectedTab { captureSnapshot(of: tab) }
      withAnimation(.smooth(duration: 0.3)) { isShowingTabSwitcher = true }
      return
    }
    let image = instantSnapshot(of: tab)
    measurePageFrame(of: tab)
    morph.start(.opening, tabID: tab.id, image: image, progress: 0)
    isShowingTabSwitcher = true
    let morph = self.morph
    animateMorph(to: 1, reveal: 1) {
      morph.finish()
    }
    captureSnapshot(of: tab)
  }

  func hideTabSwitcher() {
    if let tab = selectedTab {
      openFromOverview(tab)
    } else {
      withAnimation(.smooth(duration: 0.3)) { isShowingTabSwitcher = false }
    }
  }

  func openFromOverview(_ tab: BrowserTab) {
    guard usesOverviewMorph, isShowingTabSwitcher, !morph.isActive else {
      if morph.isActive { return }
      withAnimation(.smooth(duration: 0.3)) { select(tab) }
      return
    }
    loadSnapshotIfNeeded(tab)
    if let current = selectedTab { measurePageFrame(of: current) }
    morph.start(.closing, tabID: tab.id, image: tab.snapshot, progress: 1)
    select(tab, keepingOverview: true)
    animateMorph(to: 0, reveal: 0) { [weak self] in
      self?.isShowingTabSwitcher = false
      self?.morph.finish()
    }
  }

  func beginInteractiveOverview() -> Bool {
    guard usesOverviewMorph, !isShowingTabSwitcher, !morph.isActive, !entry.isPresented,
      let tab = selectedTab, tab.webView != nil
    else { return false }
    let image = instantSnapshot(of: tab)
    measurePageFrame(of: tab)
    morph.start(.interactive, tabID: tab.id, image: image, progress: 0)
    isShowingTabSwitcher = true
    return true
  }

  func updateInteractiveOverview(_ progress: CGFloat, translation: CGSize = .zero) {
    guard morph.phase == .interactive else { return }
    morph.progress = min(max(progress, 0), 1)
    morph.cardReveal = morph.progress
    morph.translation = translation
  }

  func endInteractiveOverview(commit: Bool) {
    guard morph.phase == .interactive else { return }
    let morph = self.morph
    withAnimation(OverviewMorph.animation) {
      morph.progress = commit ? 1 : 0
      morph.cardReveal = commit ? 1 : 0
      morph.translation = .zero
    } completion: { [weak self] in
      guard let self else { return }
      if !commit { self.isShowingTabSwitcher = false }
      morph.finish()
      if commit, let tab = self.selectedTab { self.captureSnapshot(of: tab) }
    }
  }

  private func measurePageFrame(of tab: BrowserTab) {
    guard let host = tab.webView?.superview, host.window != nil, host.bounds.width > 0 else { return }
    morph.pageFrame = host.convert(host.bounds, to: nil)
  }

  private func instantSnapshot(of tab: BrowserTab) -> UIImage? {
    guard let webView = tab.webView, webView.window != nil, webView.bounds.width > 0 else { return tab.snapshot }
    let format = UIGraphicsImageRendererFormat.preferred()
    format.scale = min(webView.traitCollection.displayScale, 2)
    format.opaque = true
    var drawn = false
    let image = UIGraphicsImageRenderer(bounds: webView.bounds, format: format).image { _ in
      drawn = webView.drawHierarchy(in: webView.bounds, afterScreenUpdates: false)
    }
    guard drawn else { return tab.snapshot }
    tab.snapshot = image
    tab.snapshotLoaded = true
    return image
  }

  private func growNewTabFromPlusButton(_ tab: BrowserTab) {
    guard usesOverviewMorph, let source = morph.plusFrame, !morph.isActive else { return }
    morph.start(.growing, tabID: tab.id, image: nil, progress: 1, sourceFrame: source)
    animateMorph(to: 0, reveal: 1) { [weak self] in
      withAnimation(.easeOut(duration: 0.18)) { self?.morph.finish() }
    }
  }

  private func animateMorph(to progress: CGFloat, reveal: CGFloat, completion: @escaping () -> Void) {
    let morph = self.morph
    Task {
      try? await Task.sleep(for: .milliseconds(24))
      withAnimation(OverviewMorph.animation) {
        morph.progress = progress
        morph.cardReveal = reveal
      } completion: {
        completion()
      }
    }
  }



  func beginNewTab() {
    setChromeCollapsed(false)
    withAnimation(.snappy(duration: 0.25)) { entry.begin(newTab: true, initialText: "") }
  }

  func beginEditingCurrent() {
    guard let tab = selectedTab, let url = tab.url else {
      beginNewTab()
      return
    }
    setChromeCollapsed(false)
    withAnimation(.snappy(duration: 0.25)) { entry.begin(newTab: false, initialText: Omnibox.editingText(for: url)) }
  }

  func cancelEntry() {
    withAnimation(.snappy(duration: 0.25)) { entry.dismiss() }
    suggestions.clear()
  }

  func updateSuggestions() {
    suggestions.update(query: entry.text, browser: self)
  }

  func submitEntry() {
    if let index = entry.highlightedIndex, suggestions.suggestions.indices.contains(index) {
      choose(suggestions.suggestions[index])
      return
    }
    guard let url = Omnibox.url(for: entry.text, engine: settings.searchEngine) else { return }
    let newTab = entry.opensInNewTab
    cancelEntry()
    isShowingTabSwitcher = false
    open(url, inNewTab: newTab)
    if newTab, let tab = selectedTab { growNewTabFromPlusButton(tab) }
  }

  func choose(_ suggestion: Suggestion) {
    let newTab = entry.opensInNewTab
    cancelEntry()
    isShowingTabSwitcher = false
    switch suggestion.action {
    case .open(let url): open(url, inNewTab: newTab)
    case .search(let query): open(settings.searchEngine.searchURL(for: query), inNewTab: newTab)
    case .switchToTab(let id):
      select(tabID: id)
      return
    }
    if newTab, let tab = selectedTab { growNewTabFromPlusButton(tab) }
  }

  func complete(with suggestion: Suggestion) {
    guard let text = suggestion.completion else { return }
    entry.text = text
    entry.selection = TextSelection(insertionPoint: entry.text.endIndex)
  }

  func findInPage() {
    guard let webView = selectedTab?.webView else { return }
    webView.findInteraction?.presentFindNavigator(showingReplace: false)
  }

  func sharePage() {
    guard let tab = selectedTab, let url = tab.url else { return }
    UIKitPresenter.share(url, title: tab.title)
  }

  func openReader() {
    guard let url = selectedTab?.url, HistoryStore.isRecordable(url) else { return }
    UIKitPresenter.openReader(url)
  }

  func copyLink() {
    UIPasteboard.general.url = selectedTab?.url
  }

  func loadSnapshotIfNeeded(_ tab: BrowserTab) {
    guard !tab.snapshotLoaded else { return }
    tab.snapshotLoaded = true
    if tab.snapshot == nil, let data = persistence.snapshotData(for: tab.id) {
      tab.snapshot = UIImage(data: data)
    }
  }

  func captureSnapshot(of tab: BrowserTab) {
    guard let webView = tab.webView, webView.window != nil, webView.bounds.width > 0 else { return }
    let configuration = WKSnapshotConfiguration()
    configuration.snapshotWidth = NSNumber(value: Double(min(webView.bounds.width, 440)))
    configuration.afterScreenUpdates = true
    Task { [weak self, weak tab] in
      guard let image = try? await webView.takeSnapshot(configuration: configuration), let self, let tab else { return }
      tab.snapshot = image
      tab.snapshotLoaded = true
      if let data = image.jpegData(compressionQuality: 0.72) { self.persistence.saveSnapshot(data, for: tab.id) }
    }
  }

  func tabDidFinishLoading(_ tab: BrowserTab) {
    if let url = tab.url { history.recordVisit(url: url, title: tab.title) }
    tabsChanged()
  }

  func tabMetadataChanged() {
    tabsChanged()
  }

  private func tabsChanged() {
    scheduleSave()
    sync.tabsChanged(tabs.map(\.record))
  }

  private var session: TabSession {
    TabSession(tabs: tabs.map(\.record), selectedID: selectedTabID)
  }

  private func scheduleSave() {
    saveTask?.cancel()
    saveTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(600))
      guard !Task.isCancelled, let self else { return }
      self.persistence.save(self.session)
    }
  }

  func persistEverything() {
    saveTask?.cancel()
    for tab in tabs {
      if let webView = tab.webView {
        persistence.saveInteractionState(webView.interactionState as? Data, for: tab.id)
      }
    }
    if let tab = selectedTab { captureSnapshot(of: tab) }
    persistence.save(session)
    history.saveNow()
  }

  func settleMorph() {
    guard let settlement = OverviewMorph.settlement(for: morph.phase) else { return }
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      isShowingTabSwitcher = settlement == .showOverview
      morph.finish()
    }
  }

  func ensureSelectedPageIsLive() {
    WebHostView.reattachDetachedWebViews()
    guard let tab = selectedTab, tab.url != nil else { return }
    let webView = ensureLive(tab)
    if webView.url == nil, !webView.isLoading, let url = tab.url {
      webView.load(URLRequest(url: url))
    }
  }

  func scenePhaseChanged(_ phase: ScenePhase) {
    switch phase {
    case .active:
      settleMorph()
      ensureSelectedPageIsLive()
      sync.becameActive()
    case .inactive:
      settleMorph()
    case .background:
      settleMorph()
      sync.resignedActive()
      persistEverything()
    @unknown default:
      break
    }
  }

  var canRenameDevice: Bool { sync.client is DeviceNameEditable }

  func renameDevice(_ name: String) {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let editable = sync.client as? DeviceNameEditable, editable.thisDeviceName != trimmed else {
      return
    }
    editable.thisDeviceName = trimmed
    settings.deviceName = trimmed
  }

  func clearHistory() {
    history.clear()
  }

  func clearWebsiteData() async {
    let store = WKWebsiteDataStore.default()
    await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    URLCache.shared.removeAllCachedResponses()
  }
}
