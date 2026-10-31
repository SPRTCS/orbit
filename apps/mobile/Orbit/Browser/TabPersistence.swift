import Foundation

struct TabRecord: Codable, Equatable, Identifiable, Sendable {
  var id: UUID
  var url: URL?
  var title: String
  var lastActive: Date
  var pinID: String?
  var homeURL: URL?
}

struct TabSession: Codable, Equatable, Sendable {
  var tabs: [TabRecord]
  var selectedID: UUID?
  var pinTabs: [TabRecord]?

  static let empty = TabSession(tabs: [], selectedID: nil)
}

struct HistoryEntry: Codable, Equatable, Identifiable, Sendable {
  var url: URL
  var title: String
  var lastVisit: Date
  var visitCount: Int

  var id: URL { url }
}

final class TabPersistence {
  let directory: URL
  private let queue = DispatchQueue(label: "com.ais.orbit-mobile.persistence", qos: .utility)

  init(directory: URL) {
    self.directory = directory
    for folder in [directory, statesDirectory, snapshotsDirectory] {
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }
  }

  static func standard() -> TabPersistence {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return TabPersistence(directory: base.appending(path: "Orbit", directoryHint: .isDirectory))
  }

  private var sessionURL: URL { directory.appending(path: "session.json") }
  private var historyURL: URL { directory.appending(path: "history.json") }
  private var statesDirectory: URL { directory.appending(path: "States", directoryHint: .isDirectory) }
  private var snapshotsDirectory: URL { directory.appending(path: "Snapshots", directoryHint: .isDirectory) }

  private func stateURL(for id: UUID) -> URL { statesDirectory.appending(path: "\(id.uuidString).state") }
  private func snapshotURL(for id: UUID) -> URL { snapshotsDirectory.appending(path: "\(id.uuidString).jpg") }

  func loadSession() -> TabSession {
    guard let data = read(sessionURL), let session = try? JSONDecoder().decode(TabSession.self, from: data) else {
      return .empty
    }
    return session
  }

  func save(_ session: TabSession) {
    guard let data = try? JSONEncoder().encode(session) else { return }
    write(data, to: sessionURL)
  }

  func loadHistory() -> [HistoryEntry] {
    guard let data = read(historyURL), let entries = try? JSONDecoder().decode([HistoryEntry].self, from: data) else {
      return []
    }
    return entries
  }

  func save(history: [HistoryEntry]) {
    guard let data = try? JSONEncoder().encode(history) else { return }
    write(data, to: historyURL)
  }

  func saveInteractionState(_ data: Data?, for id: UUID) {
    if let data { write(data, to: stateURL(for: id)) } else { remove(stateURL(for: id)) }
  }

  func interactionState(for id: UUID) -> Data? {
    read(stateURL(for: id))
  }

  func saveSnapshot(_ data: Data, for id: UUID) {
    write(data, to: snapshotURL(for: id))
  }

  func snapshotData(for id: UUID) -> Data? {
    read(snapshotURL(for: id))
  }

  func removeArtifacts(for id: UUID) {
    remove(stateURL(for: id))
    remove(snapshotURL(for: id))
  }

  func pruneArtifacts(keeping ids: Set<UUID>) {
    let folders = [statesDirectory, snapshotsDirectory]
    let keep = Set(ids.map(\.uuidString))
    queue.async {
      for folder in folders {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for file in files where !keep.contains(file.deletingPathExtension().lastPathComponent) {
          try? FileManager.default.removeItem(at: file)
        }
      }
    }
  }

  func removeHistory() {
    remove(historyURL)
  }

  func flush() {
    queue.sync {}
  }

  private func read(_ url: URL) -> Data? {
    queue.sync { try? Data(contentsOf: url) }
  }

  private func write(_ data: Data, to url: URL) {
    queue.async { try? data.write(to: url, options: .atomic) }
  }

  private func remove(_ url: URL) {
    queue.async { try? FileManager.default.removeItem(at: url) }
  }
}
