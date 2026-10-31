import SwiftUI
import WebKit

struct WebViewContainer: UIViewRepresentable {
  let browser: BrowserModel
  let tab: BrowserTab
  var bottomObscured: CGFloat

  func makeUIView(context: Context) -> WebHostView {
    WebHostView()
  }

  func updateUIView(_ host: WebHostView, context: Context) {
    let webView = tab.webView ?? browser.ensureLive(tab)
    host.show(webView)
    let insets = UIEdgeInsets(top: 0, left: 0, bottom: bottomObscured, right: 0)
    if webView.obscuredContentInsets != insets { webView.obscuredContentInsets = insets }
  }

  static func dismantleUIView(_ host: WebHostView, coordinator: ()) {
    host.releaseWebView()
  }
}

final class WebHostView: UIView {
  private weak var current: WKWebView?

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func show(_ webView: WKWebView) {
    guard current !== webView || webView.superview !== self else { return }
    if let current, current.superview === self { current.removeFromSuperview() }
    webView.removeFromSuperview()
    webView.frame = bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(webView)
    current = webView
  }

  func releaseWebView() {
    if let current, current.superview === self { current.removeFromSuperview() }
    current = nil
  }
}
