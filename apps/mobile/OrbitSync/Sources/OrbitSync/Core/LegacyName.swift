import Foundation

public enum LegacyName {
  public static let syncMagic = "NNS1"
  public static let syncSalt = "netnyahoo-sync/v1"
  public static let syncFolderName = "Netnyahoo Sync"
}

extension SyncKeys: @unchecked Sendable {}
