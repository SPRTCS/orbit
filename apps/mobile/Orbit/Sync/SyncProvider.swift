import Foundation
import OrbitSync

enum SyncProvider {
  static func makeClient() -> any OrbitSyncing {
    #if DEBUG
      if UserDefaults.standard.bool(forKey: "OrbitPreviewSync") { return PreviewSync(populated: true) }
    #endif
    return OrbitSyncClient()
  }
}
