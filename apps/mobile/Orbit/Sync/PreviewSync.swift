import Foundation
import OrbitSync
import UIKit

@MainActor
@Observable
final class PreviewSync: OrbitSyncing {
  var state: OrbitSyncState
  var devices: [SyncedDevice]
  var spaces: [SyncedSpace]
  var thisDeviceName: String
  var pendingDownloads = 0
  private(set) var publishedTabs: [SyncedTab] = []

  init(populated: Bool = false) {
    thisDeviceName = UIDevice.current.name
    state = populated ? .idle(lastSync: .now) : .notSetUp
    devices = populated ? Self.sampleDevices : []
    spaces = populated ? Self.sampleSpaces : []
  }

  func connect(folder: URL) throws {
    state = .needsPhrase
  }

  func enterRecoveryPhrase(_ phrase: String) async throws {
    guard case .needsPhrase = state else { throw OrbitSyncError.notConnected }
    let count = RecoveryPhrase.words(in: phrase).count
    guard count == RecoveryPhrase.expectedWordCount else {
      throw OrbitSyncError.invalidPhrase("Expected \(RecoveryPhrase.expectedWordCount) words, got \(count).")
    }
    state = .syncing
    try? await Task.sleep(for: .milliseconds(500))
    devices = Self.sampleDevices
    spaces = Self.sampleSpaces
    state = .idle(lastSync: .now)
  }

  func syncNow() async {
    guard case .idle = state else { return }
    state = .syncing
    try? await Task.sleep(for: .milliseconds(400))
    state = .idle(lastSync: .now)
  }

  func publish(openTabs: [SyncedTab]) async {
    publishedTabs = openTabs
  }

  func disconnect() {
    state = .notSetUp
    devices = []
    spaces = []
    publishedTabs = []
  }

  private static func url(_ string: String) -> URL { URL(string: string)! }

  static let sampleSpaces: [SyncedSpace] = [
    SyncedSpace(
      id: "space-personal", name: "Personal", color: "#8B7CF6", icon: "🪐", isDefault: true,
      pins: [
        SyncedPin(id: "t:1", title: "GitHub", url: url("https://github.com"), groupId: nil, folderPath: [], isTile: true),
        SyncedPin(id: "t:2", title: "YouTube", url: url("https://www.youtube.com"), groupId: nil, folderPath: [], isTile: true),
        SyncedPin(id: "t:3", title: "Gmail", url: url("https://mail.google.com"), groupId: nil, folderPath: [], isTile: true),
        SyncedPin(id: "t:4", title: "Hacker News", url: url("https://news.ycombinator.com"), groupId: nil, folderPath: ["Reading"]),
        SyncedPin(id: "g:1", title: "Morning news", url: nil, groupId: nil, folderPath: ["Reading"]),
        SyncedPin(id: "t:5", title: "The Verge", url: url("https://www.theverge.com"), groupId: "g:1", folderPath: ["Reading"]),
        SyncedPin(id: "t:6", title: "Engadget", url: url("https://www.engadget.com"), groupId: "g:1", folderPath: ["Reading"]),
        SyncedPin(id: "t:7", title: "Swift Forums", url: url("https://forums.swift.org"), groupId: nil, folderPath: ["Reading", "Dev"]),
        SyncedPin(id: "t:8", title: "Weather", url: url("https://weather.com"), groupId: nil, folderPath: []),
      ]),
    SyncedSpace(
      id: "space-work", name: "Work", color: "#4FA3F7", icon: "💼", isDefault: false,
      pins: [
        SyncedPin(id: "t:9", title: "Linear", url: url("https://linear.app"), groupId: nil, folderPath: [], isTile: true),
        SyncedPin(id: "t:10", title: "Notion", url: url("https://www.notion.so"), groupId: nil, folderPath: [], isTile: true),
        SyncedPin(id: "t:11", title: "App Store Connect", url: url("https://appstoreconnect.apple.com"), groupId: nil, folderPath: ["Shipping"]),
      ]),
  ]

  static let sampleDevices: [SyncedDevice] = [
    SyncedDevice(
      id: "space-personal/mac-book", name: "MacBook Pro", spaceId: "space-personal",
      tabs: [
        SyncedTab(url: url("https://www.apple.com/newsroom/"), title: "Newsroom - Apple"),
        SyncedTab(url: url("https://developer.apple.com/documentation/swiftui"), title: "SwiftUI | Apple Developer Documentation"),
        SyncedTab(url: url("https://www.engadget.com"), title: "Engadget"),
      ], updatedAt: .now.addingTimeInterval(-240), deviceId: "mac-book"),
    SyncedDevice(
      id: "space-work/mac-book", name: "MacBook Pro", spaceId: "space-work",
      tabs: [
        SyncedTab(url: url("https://github.com/SPRTCS/orbit"), title: "SPRTCS/orbit"),
        SyncedTab(url: url("https://linear.app"), title: "Linear"),
      ], updatedAt: .now.addingTimeInterval(-600), deviceId: "mac-book"),
    SyncedDevice(
      id: "space-personal/ipad", name: "iPad Pro", spaceId: "space-personal",
      tabs: [SyncedTab(url: url("https://www.theverge.com"), title: "The Verge")],
      updatedAt: .now.addingTimeInterval(-7200), deviceId: "ipad", kind: "ipad"),
  ]
}
