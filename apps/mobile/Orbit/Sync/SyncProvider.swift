import OrbitSync

enum SyncProvider {
  static func makeClient() -> any OrbitSyncing {
    OrbitSyncClient()
  }
}
