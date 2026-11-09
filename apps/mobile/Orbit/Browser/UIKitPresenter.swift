import UIKit

enum UIKitPresenter {
  static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window =
      scenes.flatMap(\.windows).first(where: \.isKeyWindow)
      ?? scenes.first(where: { $0.activationState == .foregroundActive })?.windows.first
    var controller = window?.rootViewController
    while let presented = controller?.presentedViewController, !presented.isBeingDismissed {
      controller = presented
    }
    return controller
  }

  static func present(_ controller: UIViewController) {
    guard let top = topViewController() else { return }
    if let popover = controller.popoverPresentationController {
      popover.sourceView = top.view
      popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 60, width: 1, height: 1)
      popover.permittedArrowDirections = [.down]
    }
    top.present(controller, animated: true)
  }

  static func share(_ url: URL, title: String?) {
    var items: [Any] = [url]
    if let title, !title.isEmpty { items.insert(title, at: 0) }
    present(UIActivityViewController(activityItems: items, applicationActivities: nil))
  }

  static func alert(title: String?, message: String) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default) { _ in continuation.resume() })
      guard let top = topViewController() else { return continuation.resume() }
      top.present(alert, animated: true)
    }
  }

  static func confirm(title: String?, message: String) async -> Bool {
    await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel) { _ in continuation.resume(returning: false) })
      alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default) { _ in continuation.resume(returning: true) })
      guard let top = topViewController() else { return continuation.resume(returning: false) }
      top.present(alert, animated: true)
    }
  }

  static func credentials(host: String, realm: String?, retrying: Bool) async -> URLCredential? {
    await withCheckedContinuation { (continuation: CheckedContinuation<URLCredential?, Never>) in
      let detail = [realm.flatMap { $0.isEmpty ? nil : $0 }, retrying ? String(localized: "The user name or password was not accepted.") : nil]
        .compactMap { $0 }.joined(separator: "\n")
      let alert = UIAlertController(
        title: String(localized: "Sign in to \(host)"), message: detail.isEmpty ? nil : detail, preferredStyle: .alert)
      alert.addTextField {
        $0.placeholder = String(localized: "User Name")
        $0.textContentType = .username
        $0.autocapitalizationType = .none
        $0.autocorrectionType = .no
      }
      alert.addTextField {
        $0.placeholder = String(localized: "Password")
        $0.textContentType = .password
        $0.isSecureTextEntry = true
      }
      alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel) { _ in continuation.resume(returning: nil) })
      alert.addAction(
        UIAlertAction(title: String(localized: "Sign In"), style: .default) { [weak alert] _ in
          let user = alert?.textFields?.first?.text ?? ""
          let password = alert?.textFields?.last?.text ?? ""
          continuation.resume(returning: URLCredential(user: user, password: password, persistence: .forSession))
        })
      guard let top = topViewController() else { return continuation.resume(returning: nil) }
      top.present(alert, animated: true)
    }
  }

  static func prompt(title: String?, message: String, defaultText: String?) async -> String? {
    await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
      let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
      alert.addTextField { $0.text = defaultText }
      alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel) { _ in continuation.resume(returning: nil) })
      alert.addAction(
        UIAlertAction(title: String(localized: "OK"), style: .default) { [weak alert] _ in
          continuation.resume(returning: alert?.textFields?.first?.text ?? "")
        })
      guard let top = topViewController() else { return continuation.resume(returning: nil) }
      top.present(alert, animated: true)
    }
  }
}
