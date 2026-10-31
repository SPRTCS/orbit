import Foundation

public struct SyncedTab: Hashable, Sendable, Codable {
  public var url: URL
  public var title: String

  public init(url: URL, title: String) {
    self.url = url
    self.title = title
  }
}

public struct SyncedDevice: Identifiable, Hashable, Sendable {
  public var id: String
  public var name: String
  public var spaceId: String
  public var tabs: [SyncedTab]
  public var updatedAt: Date?
  public var deviceId: String
  public var kind: String?

  public init(id: String, name: String, spaceId: String, tabs: [SyncedTab], updatedAt: Date?, deviceId: String? = nil, kind: String? = nil) {
    self.id = id
    self.name = name
    self.spaceId = spaceId
    self.tabs = tabs
    self.updatedAt = updatedAt
    self.deviceId = deviceId ?? id
    self.kind = kind
  }
}

public struct SyncedPin: Identifiable, Hashable, Sendable {
  public var id: String
  public var title: String
  public var url: URL?
  public var groupId: String?
  public var folderPath: [String]
  public var isTile: Bool
  public var folderId: String?

  public init(id: String, title: String, url: URL?, groupId: String?, folderPath: [String], isTile: Bool = false, folderId: String? = nil) {
    self.id = id
    self.title = title
    self.url = url
    self.groupId = groupId
    self.folderPath = folderPath
    self.isTile = isTile
    self.folderId = folderId
  }

  public var isGroup: Bool { id.hasPrefix("g:") }
}

public struct SyncedFolder: Identifiable, Hashable, Sendable {
  public var id: String
  public var name: String
  public var path: [String]
  public var parentId: String?
  public var emoji: String?
  public var color: String?

  public init(id: String, name: String, path: [String], parentId: String?, emoji: String?, color: String?) {
    self.id = id
    self.name = name
    self.path = path
    self.parentId = parentId
    self.emoji = emoji
    self.color = color
  }
}

public struct SyncedSpace: Identifiable, Hashable, Sendable {
  public var id: String
  public var name: String
  public var color: String?
  public var icon: String?
  public var isDefault: Bool
  public var pins: [SyncedPin]
  public var theme: SyncedTheme?
  public var folders: [SyncedFolder]

  public init(id: String, name: String, color: String?, icon: String?, isDefault: Bool, pins: [SyncedPin], theme: SyncedTheme? = nil, folders: [SyncedFolder] = []) {
    self.id = id
    self.name = name
    self.color = color
    self.icon = icon
    self.isDefault = isDefault
    self.pins = pins
    self.theme = theme
    self.folders = folders
  }

  public var displayTheme: SyncedTheme { theme ?? SyncedTheme.glass(for: color ?? "plum") }
}

public enum OrbitSyncState: Equatable, Sendable {
  case notSetUp
  case needsPhrase
  case syncing
  case idle(lastSync: Date?)
  case failed(String)
}

public enum OrbitSyncError: Error, Equatable, Sendable {
  case folderUnreadable(String)
  case invalidPhrase(String)
  case phraseDoesNotMatchFolder
  case notConnected
}

@MainActor
public protocol OrbitSyncing: AnyObject, Observable {
  var state: OrbitSyncState { get }
  var devices: [SyncedDevice] { get }
  var spaces: [SyncedSpace] { get }
  var thisDeviceName: String { get }

  func connect(folder: URL) throws
  func enterRecoveryPhrase(_ phrase: String) async throws
  func syncNow() async
  func publish(openTabs: [SyncedTab]) async
  func disconnect()
}
