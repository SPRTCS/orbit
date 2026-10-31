import SwiftUI
import WebKit

struct WebViewContainer: UIViewRepresentable {
  let browser: BrowserModel
  let tab: BrowserTab
  var bottomObscured: CGFloat
  var ignoresSafeArea = false

  func makeUIView(context: Context) -> WebHostView {
    WebHostView()
  }

  func updateUIView(_ host: WebHostView, context: Context) {
    let webView = tab.webView ?? browser.ensureLive(tab)
    host.show(webView)
    (webView as? OrbitWebView)?.ignoresSafeArea = ignoresSafeArea
    let insets = UIEdgeInsets(top: 0, left: 0, bottom: bottomObscured, right: 0)
    if webView.obscuredContentInsets != insets { webView.obscuredContentInsets = insets }
  }

  static func dismantleUIView(_ host: WebHostView, coordinator: ()) {
    host.releaseWebView()
  }
}

final class WebHostView: UIView {
  private static let hosts = NSHashTable<WebHostView>.weakObjects()
  private weak var current: WKWebView?

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    Self.hosts.add(self)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func show(_ webView: WKWebView) {
    current = webView
    guard webView.superview !== self else { return }
    for subview in subviews where subview is WKWebView { subview.removeFromSuperview() }
    webView.removeFromSuperview()
    attach(webView)
  }

  func releaseWebView() {
    guard let current, current.superview === self else {
      self.current = nil
      return
    }
    current.removeFromSuperview()
    self.current = nil
    Self.reattachDetachedWebViews()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reclaimIfDetached()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    reclaimIfDetached()
  }

  static func reattachDetachedWebViews() {
    for host in hosts.allObjects { host.reclaimIfDetached() }
  }

  private func reclaimIfDetached() {
    guard window != nil, let current, current.superview == nil || current.window == nil else { return }
    current.removeFromSuperview()
    attach(current)
  }

  private func attach(_ webView: WKWebView) {
    webView.frame = bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(webView)
  }
}
