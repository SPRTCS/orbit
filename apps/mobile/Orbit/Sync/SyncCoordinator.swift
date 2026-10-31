import Foundation
import OrbitSync

@Observable
final class SyncCoordinator {
  static let interval: Duration = .seconds(30)
  static let maxPublishedTabs = 30

  let client: any OrbitSyncing
  @ObservationIgnored private var loopTask: Task<Void, Never>?
  @ObservationIgnored private var publishTask: Task<Void, Never>?
  @ObservationIgnored private var pendingTabs: [SyncedTab] = []
  @ObservationIgnored private var lastPublished: [SyncedTab]?

  init(client: any OrbitSyncing) {
    self.client = client
  }

  var isConnected: Bool {
    switch client.state {
    case .idle, .syncing, .failed: true
    case .notSetUp, .needsPhrase: false
    }
  }

  var isSyncing: Bool { client.state == .syncing }

  var statusText: String {
    switch client.state {
    case .notSetUp: "Not set up"
    case .needsPhrase: "Waiting for recovery phrase"
    case .syncing: "Syncing…"
    case .idle(let lastSync):
      if pendingDownloads > 0 {
        "Waiting for iCloud to download \(pendingDownloads) \(pendingDownloads == 1 ? "file" : "files")"
      } else if let lastSync {
        "Synced \(lastSync.formatted(.relative(presentation: .named)))"
      } else {
        "Connected"
      }
    case .failed(let message): message
    }
  }

  var otherDevices: [SyncedDevice] {
    client.devices
  }

  var recentDevices: [SyncedDevice] {
    var seen: Set<String> = []
    return client.devices
      .filter { !$0.tabs.isEmpty }
      .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
      .filter { seen.insert($0.deviceId).inserted }
  }

  var pendingDownloads: Int {
    (client as? SyncDownloadReporting)?.pendingDownloads ?? 0
  }

  var defaultSpace: SyncedSpace? {
    client.spaces.first(where: \.isDefault) ?? client.spaces.first
  }

  func devices(in space: SyncedSpace) -> [SyncedDevice] {
    let knownSpaces = Set(client.spaces.map(\.id))
    return otherDevices.filter { $0.spaceId == space.id || (!knownSpaces.contains($0.spaceId) && space.id == defaultSpace?.id) }
  }

  func becameActive() {
    loopTask?.cancel()
    loopTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.syncIfConnected()
        try? await Task.sleep(for: Self.interval)
      }
    }
  }

  func resignedActive() {
    loopTask?.cancel()
    loopTask = nil
  }

  func refresh() async {
    await syncIfConnected()
  }

  func refreshInBackground() {
    Task { await syncIfConnected() }
  }

  func didConnect() {
    lastPublished = nil
    schedulePublish(delay: .zero)
    refreshInBackground()
  }

  func tabsChanged(_ records: [TabRecord]) {
    pendingTabs = Self.publishable(records)
    guard pendingTabs != lastPublished else { return }
    schedulePublish(delay: .seconds(2))
  }

  static func publishable(_ records: [TabRecord]) -> [SyncedTab] {
    records
      .filter { $0.url.map(HistoryStore.isRecordable) ?? false }
      .sorted { $0.lastActive > $1.lastActive }
      .prefix(maxPublishedTabs)
      .compactMap { record in
        guard let url = record.url else { return nil }
        return SyncedTab(url: url, title: record.title.isEmpty ? Omnibox.displayHost(url) : record.title)
      }
  }

  private func syncIfConnected() async {
    guard isConnected else { return }
    await client.syncNow()
  }

  private func schedulePublish(delay: Duration) {
    publishTask?.cancel()
    publishTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled, let self, self.isConnected else { return }
      let tabs = self.pendingTabs
      guard tabs != self.lastPublished else { return }
      self.lastPublished = tabs
      await self.client.publish(openTabs: tabs)
    }
  }
}
