import UIKit
import WebKit

@Observable
final class BrowserTab: Identifiable {
  let id: UUID
  var url: URL?
  var title: String
  var lastActive: Date
  var progress: Double = 0
  var isLoading = false
  var canGoBack = false
  var canGoForward = false
  var snapshot: UIImage?
  var themeColor: UIColor?
  var loadError: String?

  let pinID: String?
  let homeURL: URL?
  @ObservationIgnored var controller: TabWebController?
  @ObservationIgnored var snapshotLoaded = false
  @ObservationIgnored var failedURL: URL?

  init(id: UUID = UUID(), url: URL?, title: String = "", lastActive: Date = .now, pinID: String? = nil, homeURL: URL? = nil) {
    self.id = id
    self.url = url
    self.title = title
    self.lastActive = lastActive
    self.pinID = pinID
    self.homeURL = homeURL
  }

  convenience init(record: TabRecord) {
    self.init(
      id: record.id, url: record.url, title: record.title, lastActive: record.lastActive, pinID: record.pinID,
      homeURL: record.homeURL)
  }

  var record: TabRecord {
    TabRecord(id: id, url: url, title: title, lastActive: lastActive, pinID: pinID, homeURL: homeURL)
  }

  var isPinTab: Bool { pinID != nil }

  var webView: WKWebView? { controller?.webView }

  var isBlank: Bool { url == nil && controller == nil }

  var host: String? { url.map(Omnibox.displayHost) }

  var displayTitle: String {
    if !title.isEmpty { return title }
    return host ?? "New Tab"
  }
}
