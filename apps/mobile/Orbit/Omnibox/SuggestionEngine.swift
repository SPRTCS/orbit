import Foundation
import OrbitSync

struct Suggestion: Identifiable, Equatable {
  enum Action: Equatable {
    case open(URL)
    case search(String)
    case switchToTab(UUID)
  }

  let id: String
  let title: String
  let subtitle: String?
  let systemImage: String
  let badge: String?
  let action: Action

  var completion: String? {
    switch action {
    case .search(let query): query
    case .open(let url): url.absoluteString
    case .switchToTab: nil
    }
  }
}

@Observable
final class SuggestionEngine {
  private(set) var suggestions: [Suggestion] = []

  @ObservationIgnored private var remoteTask: Task<Void, Never>?
  @ObservationIgnored private var remoteQuery = ""
  @ObservationIgnored private var remoteResults: [String] = []
  @ObservationIgnored private let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 4
    configuration.httpAdditionalHeaders = ["Accept": "application/json"]
    return URLSession(configuration: configuration)
  }()

  func update(query: String, browser: BrowserModel) {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    suggestions = build(trimmed, browser: browser)
    remoteTask?.cancel()
    guard !trimmed.isEmpty, browser.settings.searchSuggestionsEnabled, Omnibox.fixup(trimmed) == nil || trimmed.count < 40
    else { return }
    let engine = browser.settings.searchEngine
    remoteTask = Task { [weak self, weak browser] in
      try? await Task.sleep(for: .milliseconds(120))
      guard !Task.isCancelled, let self else { return }
      guard let response = try? await self.session.data(from: engine.suggestURL(for: trimmed)), !Task.isCancelled,
        let browser
      else { return }
      self.remoteQuery = trimmed
      self.remoteResults = SearchEngine.parseSuggestions(response.0)
      self.suggestions = self.build(trimmed, browser: browser)
    }
  }

  func clear() {
    remoteTask?.cancel()
    suggestions = []
  }

  private func build(_ query: String, browser: BrowserModel) -> [Suggestion] {
    var result: [Suggestion] = []
    var seen: Set<String> = []

    func add(_ suggestion: Suggestion, key: String) {
      guard !seen.contains(key) else { return }
      seen.insert(key)
      result.append(suggestion)
    }

    let engine = browser.settings.searchEngine
    let sync = browser.sync

    if query.isEmpty {
      for device in sync.recentDevices.prefix(2) {
        for tab in device.tabs.prefix(3) {
          add(syncedTabSuggestion(tab, device: device), key: Omnibox.matchKey(tab.url))
        }
      }
      for entry in browser.history.recent(limit: 6) {
        add(historySuggestion(entry), key: Omnibox.matchKey(entry.url))
      }
      return result
    }

    let needle = query.lowercased()
    switch Omnibox.resolve(query) {
    case .url(let url):
      add(
        Suggestion(
          id: "typed-url", title: Omnibox.displayHost(url) + displayPath(url), subtitle: "Open website",
          systemImage: "globe", badge: nil, action: .open(url)),
        key: Omnibox.matchKey(url))
      add(searchSuggestion(query, engine: engine, id: "typed-search"), key: "search:\(needle)")
    case .search(let text):
      add(searchSuggestion(text, engine: engine, id: "typed-search"), key: "search:\(text.lowercased())")
    case nil:
      break
    }

    let tabMatches = browser.tabs.filter { tab in
      guard tab.id != browser.selectedTabID, let url = tab.url else { return false }
      return HistoryStore.matchScore(needle, title: tab.title, url: url) != nil
    }
    for tab in tabMatches.prefix(3) {
      guard let url = tab.url else { continue }
      add(
        Suggestion(
          id: "tab-\(tab.id)", title: tab.displayTitle, subtitle: Omnibox.displayHost(url),
          systemImage: "square.on.square", badge: "Switch to Tab", action: .switchToTab(tab.id)),
        key: Omnibox.matchKey(url))
    }

    for entry in browser.history.matches(needle, limit: 4) {
      add(historySuggestion(entry), key: Omnibox.matchKey(entry.url))
    }

    var pinCount = 0
    for space in sync.client.spaces {
      let groupNames = Dictionary(space.pins.filter { $0.url == nil }.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
      for pin in space.pins where pinCount < 3 {
        guard let url = pin.url, HistoryStore.matchScore(needle, title: pin.title, url: url) != nil else { continue }
        let group = pin.groupId.flatMap { groupNames[$0] }.map { [$0] } ?? []
        let path = ([space.icon.map { "\($0) \(space.name)" } ?? space.name] + pin.folderPath + group).joined(separator: " › ")
        add(
          Suggestion(
            id: "pin-\(space.id)-\(pin.id)", title: pin.title, subtitle: path, systemImage: "pin",
            badge: nil, action: .open(url)),
          key: Omnibox.matchKey(url))
        pinCount += 1
      }
    }

    var syncedCount = 0
    for device in sync.otherDevices {
      for tab in device.tabs where syncedCount < 3 {
        guard HistoryStore.matchScore(needle, title: tab.title, url: tab.url) != nil else { continue }
        add(syncedTabSuggestion(tab, device: device), key: Omnibox.matchKey(tab.url))
        syncedCount += 1
      }
    }

    if !remoteResults.isEmpty, needle.hasPrefix(remoteQuery.lowercased()) || remoteQuery.lowercased().hasPrefix(needle) {
      for phrase in remoteResults.prefix(6) where phrase.lowercased().hasPrefix(needle) || remoteQuery == query {
        add(searchSuggestion(phrase, engine: engine, id: "remote-\(phrase)"), key: "search:\(phrase.lowercased())")
      }
    }
    return result
  }

  private func displayPath(_ url: URL) -> String {
    let path = url.path()
    return path == "/" ? "" : path
  }

  private func searchSuggestion(_ text: String, engine: SearchEngine, id: String) -> Suggestion {
    Suggestion(
      id: id, title: text, subtitle: id == "typed-search" ? "Search \(engine.name)" : nil,
      systemImage: "magnifyingglass", badge: nil, action: .search(text))
  }

  private func historySuggestion(_ entry: HistoryEntry) -> Suggestion {
    Suggestion(
      id: "history-\(entry.url.absoluteString)", title: entry.title.isEmpty ? Omnibox.displayHost(entry.url) : entry.title,
      subtitle: Omnibox.displayHost(entry.url), systemImage: "clock.arrow.circlepath", badge: nil,
      action: .open(entry.url))
  }

  private func syncedTabSuggestion(_ tab: SyncedTab, device: SyncedDevice) -> Suggestion {
    Suggestion(
      id: "synced-\(device.deviceId)-\(tab.url.absoluteString)", title: tab.title,
      subtitle: "\(device.name) · \(Omnibox.displayHost(tab.url))", systemImage: device.systemImage, badge: nil,
      action: .open(tab.url))
  }
}
