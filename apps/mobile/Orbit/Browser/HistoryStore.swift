import Foundation

@Observable
final class HistoryStore {
  static let limit = 5000

  @ObservationIgnored private var entries: [URL: HistoryEntry] = [:]
  @ObservationIgnored private let persistence: TabPersistence
  @ObservationIgnored private var saveTask: Task<Void, Never>?

  init(persistence: TabPersistence) {
    self.persistence = persistence
    for entry in persistence.loadHistory() { entries[entry.url] = entry }
  }

  var count: Int { entries.count }

  func recordVisit(url: URL, title: String, at date: Date = .now) {
    guard Self.isRecordable(url) else { return }
    var entry = entries[url] ?? HistoryEntry(url: url, title: title, lastVisit: date, visitCount: 0)
    entry.visitCount += 1
    entry.lastVisit = date
    if !title.isEmpty { entry.title = title }
    entries[url] = entry
    trimIfNeeded()
    scheduleSave()
  }

  func updateTitle(_ title: String, for url: URL) {
    guard !title.isEmpty, var entry = entries[url], entry.title != title else { return }
    entry.title = title
    entries[url] = entry
    scheduleSave()
  }

  func recent(limit: Int) -> [HistoryEntry] {
    Array(entries.values.sorted { $0.lastVisit > $1.lastVisit }.prefix(limit))
  }

  func matches(_ query: String, limit: Int, now: Date = .now) -> [HistoryEntry] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !needle.isEmpty else { return [] }
    var scored: [(HistoryEntry, Double)] = []
    for entry in entries.values {
      guard let base = Self.matchScore(needle, title: entry.title, url: entry.url) else { continue }
      let ageDays = max(0, now.timeIntervalSince(entry.lastVisit) / 86_400)
      let score = base * 1000 + Double(min(entry.visitCount, 50)) * 10 - min(ageDays, 300)
      scored.append((entry, score))
    }
    return scored.sorted { $0.1 > $1.1 }.prefix(limit).map(\.0)
  }

  static func matchScore(_ needle: String, title: String, url: URL) -> Double? {
    let key = Omnibox.matchKey(url)
    if key.hasPrefix(needle) { return 3 }
    if key.contains(needle) { return 2 }
    if title.localizedCaseInsensitiveContains(needle) { return 1 }
    return nil
  }

  static func isRecordable(_ url: URL) -> Bool {
    url.scheme == "https" || url.scheme == "http"
  }

  func clear() {
    entries.removeAll()
    saveTask?.cancel()
    persistence.removeHistory()
  }

  func saveNow() {
    saveTask?.cancel()
    persistence.save(history: Array(entries.values))
  }

  private func trimIfNeeded() {
    guard entries.count > Self.limit + 200 else { return }
    let keep = entries.values.sorted { $0.lastVisit > $1.lastVisit }.prefix(Self.limit)
    entries = Dictionary(uniqueKeysWithValues: keep.map { ($0.url, $0) })
  }

  private func scheduleSave() {
    saveTask?.cancel()
    saveTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(2))
      guard !Task.isCancelled, let self else { return }
      self.persistence.save(history: Array(self.entries.values))
    }
  }
}
