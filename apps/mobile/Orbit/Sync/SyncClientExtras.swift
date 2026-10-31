import OrbitSync

protocol DeviceNameEditable: AnyObject {
  var thisDeviceName: String { get set }
}

protocol SyncDownloadReporting: AnyObject {
  var pendingDownloads: Int { get }
}

extension PreviewSync: DeviceNameEditable, SyncDownloadReporting {}
extension OrbitSyncClient: DeviceNameEditable, SyncDownloadReporting {}

extension SyncedDevice {
  var systemImage: String {
    switch kind {
    case "iphone": "iphone"
    case "ipad": "ipad"
    default: "laptopcomputer"
    }
  }
}
