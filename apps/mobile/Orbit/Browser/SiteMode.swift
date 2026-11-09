import UIKit
import WebKit

enum SiteMode: String, Codable {
  case mobile
  case desktop

  var contentMode: WKWebpagePreferences.ContentMode { self == .desktop ? .desktop : .mobile }

  var userAgent: String? {
    self == .desktop ? Self.desktopUserAgent(osMajor: Self.osMajor) : nil
  }

  static var osMajor: Int { ProcessInfo.processInfo.operatingSystemVersion.majorVersion }

  static func desktopUserAgent(osMajor: Int) -> String {
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(osMajor).0 Safari/605.1.15"
  }

  static func mobileApplicationName(osMajor: Int) -> String {
    "Version/\(osMajor).0 Mobile/15E148 Safari/604.1"
  }

  static let desktopMinimumPageWidth: CGFloat = 650

  static func automatic(isPad: Bool, pageWidth: CGFloat?) -> SiteMode {
    guard isPad else { return .mobile }
    guard let pageWidth, pageWidth > 0 else { return .desktop }
    return pageWidth >= desktopMinimumPageWidth ? .desktop : .mobile
  }
}

enum PageZoom {
  static let steps: [Double] = [0.5, 0.67, 0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3]

  static func stepped(_ current: Double, by direction: Int) -> Double {
    let nearest = steps.indices.min { abs(steps[$0] - current) < abs(steps[$1] - current) } ?? 4
    return steps[min(max(nearest + direction, 0), steps.count - 1)]
  }

  static func label(_ zoom: Double) -> String {
    "\(Int((zoom * 100).rounded()))%"
  }
}
