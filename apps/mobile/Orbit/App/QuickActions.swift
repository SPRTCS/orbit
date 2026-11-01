import SwiftUI
import UIKit

enum QuickAction: String {
  case newTab = "com.ais.orbit-mobile.new-tab"
  case newPrivateTab = "com.ais.orbit-mobile.new-private-tab"

  init?(_ item: UIApplicationShortcutItem) {
    self.init(rawValue: item.type)
  }
}

@Observable
final class QuickActionInbox {
  static let shared = QuickActionInbox()

  var pending: QuickAction?

  func receive(_ item: UIApplicationShortcutItem) -> Bool {
    guard let action = QuickAction(item) else { return false }
    pending = action
    return true
  }
}

final class OrbitAppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    if let item = options.shortcutItem { _ = QuickActionInbox.shared.receive(item) }
    let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
    configuration.delegateClass = OrbitSceneDelegate.self
    return configuration
  }
}

final class OrbitSceneDelegate: NSObject, UIWindowSceneDelegate {
  func windowScene(
    _ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(QuickActionInbox.shared.receive(shortcutItem))
  }
}
