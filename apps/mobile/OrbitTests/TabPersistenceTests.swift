import Foundation
import OrbitSync
import Testing

@testable import Orbit

struct TabPersistenceTests {
  private func makePersistence() -> TabPersistence {
    TabPersistence(directory: FileManager.default.temporaryDirectory.appending(path: "OrbitTests-\(UUID().uuidString)"))
  }

  private func record(_ url: String?, title: String = "", minutesAgo: Double = 0) -> TabRecord {
    TabRecord(
      id: UUID(), url: url.flatMap(URL.init(string:)), title: title,
      lastActive: Date(timeIntervalSinceReferenceDate: 800_000_000 - minutesAgo * 60))
  }

  @Test func sessionRoundTrips() {
    let persistence = makePersistence()
    let tabs = [record("https://apple.com", title: "Apple"), record(nil), record("https://example.com", minutesAgo: 5)]
    let session = TabSession(tabs: tabs, selectedID: tabs[0].id)
    persistence.save(session)
    persistence.flush()
    #expect(TabPersistence(directory: persistence.directory).loadSession() == session)
  }

  @Test func missingOrCorruptSessionLoadsEmpty() throws {
    let persistence = makePersistence()
    #expect(persistence.loadSession() == .empty)
    try Data("not json".utf8).write(to: persistence.directory.appending(path: "session.json"))
    #expect(persistence.loadSession() == .empty)
  }

  @Test func interactionStateAndSnapshotsRoundTripAndPrune() {
    let persistence = makePersistence()
    let kept = UUID()
    let dropped = UUID()
    persistence.saveInteractionState(Data([1, 2, 3]), for: kept)
    persistence.saveInteractionState(Data([4]), for: dropped)
    persistence.saveSnapshot(Data([9]), for: dropped)
    #expect(persistence.interactionState(for: kept) == Data([1, 2, 3]))
    #expect(persistence.snapshotData(for: dropped) == Data([9]))

    persistence.pruneArtifacts(keeping: [kept])
    persistence.flush()
    #expect(persistence.interactionState(for: kept) == Data([1, 2, 3]))
    #expect(persistence.interactionState(for: dropped) == nil)
    #expect(persistence.snapshotData(for: dropped) == nil)

    persistence.saveInteractionState(nil, for: kept)
    #expect(persistence.interactionState(for: kept) == nil)
  }

  @Test func historyRoundTripsAndRanksMatches() {
    let persistence = makePersistence()
    let history = HistoryStore(persistence: persistence)
    let now = Date()
    history.recordVisit(url: URL(string: "https://news.ycombinator.com/")!, title: "Hacker News", at: now)
    history.recordVisit(url: URL(string: "https://example.com/news")!, title: "Example", at: now)
    history.recordVisit(url: URL(string: "https://example.com/news")!, title: "Example", at: now)
    history.recordVisit(url: URL(string: "about:blank")!, title: "", at: now)
    #expect(history.count == 2)
    #expect(history.matches("news", limit: 5, now: now).map(\.url.host) == ["news.ycombinator.com", "example.com"])
    history.saveNow()
    persistence.flush()

    let reloadedPersistence = TabPersistence(directory: persistence.directory)
    let reloaded = HistoryStore(persistence: reloadedPersistence)
    #expect(reloaded.count == 2)
    #expect(reloaded.matches("example", limit: 5, now: now).first?.visitCount == 2)

    reloaded.clear()
    reloadedPersistence.flush()
    #expect(TabPersistence(directory: persistence.directory).loadHistory().isEmpty)
  }

  @Test func publishesRecentWebTabsFirstAndCapsAtThirty() {
    var records = (0..<40).map { record("https://site\($0).example.com", title: "Site \($0)", minutesAgo: Double($0)) }
    records.append(record(nil, minutesAgo: -10))
    records.append(record("file:///tmp/a.html", minutesAgo: -10))
    records.append(record("https://untitled.example.com", title: "", minutesAgo: -5))
    let published = SyncCoordinator.publishable(records.shuffled())
    #expect(published.count == SyncCoordinator.maxPublishedTabs)
    #expect(published.first == SyncedTab(url: URL(string: "https://untitled.example.com")!, title: "untitled.example.com"))
    #expect(published[1].title == "Site 0")
    #expect(published.allSatisfy { $0.url.scheme == "https" })
  }

  @Test func pinLayoutSplitsTilesFoldersAndGroups() {
    let layout = PinLayout(pins: PreviewSync.sampleSpaces[0].pins)
    #expect(layout.tiles.map(\.title) == ["GitHub", "YouTube", "Gmail"])
    #expect(layout.sections.map(\.title) == ["", "Reading", "Reading › Dev"])
    #expect(layout.sections[0].entries.map(\.id) == ["t:8"])
    #expect(layout.sections[1].entries.map(\.id) == ["t:4", "g:1"])
    guard case .group(let group, let members) = layout.sections[1].entries[1] else {
      Issue.record("Expected a tab group")
      return
    }
    #expect(group.title == "Morning news")
    #expect(members.map(\.title) == ["The Verge", "Engadget"])
  }

  @Test func recentDevicesAreUniquePerDevice() {
    let sync = SyncCoordinator(client: PreviewSync(populated: true))
    #expect(sync.recentDevices.map(\.deviceId) == ["mac-book", "ipad"])
    #expect(sync.recentDevices.first?.spaceId == "space-personal")
  }

  @Test func browserRestoresTabsAndSelection() {
    let persistence = makePersistence()
    let tabs = [record("https://apple.com", title: "Apple", minutesAgo: 10), record("https://example.com", title: "Example")]
    persistence.save(TabSession(tabs: tabs, selectedID: tabs[0].id))
    persistence.flush()
    let browser = BrowserModel(
      persistence: TabPersistence(directory: persistence.directory),
      settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
      syncClient: PreviewSync())
    #expect(browser.tabs.map(\.id) == tabs.map(\.id))
    #expect(browser.selectedTabID == tabs[0].id)
    #expect(browser.tabs.map(\.title) == ["Apple", "Example"])
    #expect(!browser.entry.isPresented)
  }

  @Test func emptySessionOpensAddressEntry() {
    let browser = BrowserModel(
      persistence: makePersistence(),
      settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
      syncClient: PreviewSync())
    #expect(browser.tabs.isEmpty)
    #expect(browser.entry.isPresented)
    #expect(browser.entry.opensInNewTab)
  }

  @Test func closingSelectedTabSelectsMostRecentRemaining() {
    let persistence = makePersistence()
    let tabs = [
      record(nil, title: "A", minutesAgo: 30), record(nil, title: "B", minutesAgo: 1), record(nil, title: "C", minutesAgo: 20),
    ]
    persistence.save(TabSession(tabs: tabs, selectedID: tabs[2].id))
    persistence.flush()
    let browser = BrowserModel(
      persistence: TabPersistence(directory: persistence.directory),
      settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
      syncClient: PreviewSync())
    browser.closeSelectedTab()
    #expect(browser.selectedTab?.title == "B")
    browser.reopenClosedTab()
    #expect(browser.tabs.count == 2)
  }
}
