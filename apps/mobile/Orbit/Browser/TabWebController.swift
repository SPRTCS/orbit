import UIKit
import WebKit

final class TabWebController: NSObject, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  private weak var tab: BrowserTab?
  private weak var browser: BrowserModel?
  private var observations: [NSKeyValueObservation] = []
  private let refreshControl = UIRefreshControl()
  private var panStartOffset: CGFloat = 0

  private static let embeddedSchemes: Set<String> = ["http", "https", "about", "data", "blob", "file", "javascript"]

  init(webView: WKWebView, tab: BrowserTab, browser: BrowserModel) {
    self.webView = webView
    self.tab = tab
    self.browser = browser
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
    webView.scrollView.refreshControl = refreshControl
    webView.scrollView.panGestureRecognizer.addTarget(self, action: #selector(handlePan(_:)))
    observeWebView()
    syncState()
  }

  func tearDown() {
    observations.removeAll()
    webView.scrollView.panGestureRecognizer.removeTarget(self, action: nil)
    webView.scrollView.refreshControl = nil
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.removeFromSuperview()
  }

  private func observeWebView() {
    observations = [
      observe(\.title), observe(\.url), observe(\.estimatedProgress), observe(\.isLoading),
      observe(\.canGoBack), observe(\.canGoForward), observe(\.themeColor),
    ]
  }

  private func observe<Value>(_ keyPath: KeyPath<WKWebView, Value>) -> NSKeyValueObservation {
    webView.observe(keyPath) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.syncState() }
    }
  }

  func syncState() {
    guard let tab else { return }
    var metadataChanged = false
    if let url = webView.url, tab.url != url {
      tab.url = url
      metadataChanged = true
    }
    let title = webView.title ?? ""
    if !title.isEmpty, tab.title != title {
      tab.title = title
      metadataChanged = true
      if let url = tab.url { browser?.history.updateTitle(title, for: url) }
    }
    if tab.progress != webView.estimatedProgress { tab.progress = webView.estimatedProgress }
    if tab.isLoading != webView.isLoading { tab.isLoading = webView.isLoading }
    if tab.canGoBack != webView.canGoBack { tab.canGoBack = webView.canGoBack }
    if tab.canGoForward != webView.canGoForward { tab.canGoForward = webView.canGoForward }
    if tab.themeColor != webView.themeColor { tab.themeColor = webView.themeColor }
    if metadataChanged { browser?.tabMetadataChanged() }
  }

  @objc private func pullToRefresh() {
    if tab?.loadError != nil, let failed = tab?.failedURL {
      webView.load(URLRequest(url: failed))
    } else {
      webView.reload()
    }
    browser?.sync.refreshInBackground()
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(8))
      self?.refreshControl.endRefreshing()
    }
  }

  @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
    let scrollView = webView.scrollView
    switch pan.state {
    case .began:
      panStartOffset = scrollView.contentOffset.y
    case .changed:
      let offset = scrollView.contentOffset.y
      let delta = offset - panStartOffset
      let atTop = offset <= -scrollView.adjustedContentInset.top + 4
      if delta > 28, !atTop {
        browser?.setChromeCollapsed(true)
      } else if delta < -28 || atTop {
        browser?.setChromeCollapsed(false)
      }
    default:
      break
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async
    -> WKNavigationActionPolicy
  {
    guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return .allow }
    if !Self.embeddedSchemes.contains(scheme) {
      _ = await UIApplication.shared.open(url)
      return .cancel
    }
    if navigationAction.navigationType == .linkActivated, navigationAction.modifierFlags.contains(.command) {
      browser?.openInBackground(url)
      return .cancel
    }
    return .allow
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tab?.loadError = nil
    tab?.failedURL = nil
    syncState()
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    syncState()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    refreshControl.endRefreshing()
    syncState()
    if let tab { browser?.tabDidFinishLoading(tab) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
    refreshControl.endRefreshing()
    syncState()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error
  ) {
    refreshControl.endRefreshing()
    syncState()
    let nsError = error as NSError
    let ignored =
      (nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled)
      || (nsError.domain == "WebKitErrorDomain" && [102, 204].contains(nsError.code))
    guard !ignored else { return }
    tab?.failedURL = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? tab?.url
    tab?.loadError = nsError.localizedDescription
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    browser?.openPopup(configuration: configuration)
  }

  func webViewDidClose(_ webView: WKWebView) {
    if let tab { browser?.close(tab) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
    await UIKitPresenter.alert(title: frame.request.url?.host(), message: message)
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
    await UIKitPresenter.confirm(title: frame.request.url?.host(), message: message)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo
  ) async -> String? {
    await UIKitPresenter.prompt(title: frame.request.url?.host(), message: prompt, defaultText: defaultText)
  }

  func webView(_ webView: WKWebView, contextMenuConfigurationFor elementInfo: WKContextMenuElementInfo) async
    -> UIContextMenuConfiguration?
  {
    guard let linkURL = elementInfo.linkURL else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] suggested in
      let openNew = UIAction(title: "Open in New Tab", image: UIImage(systemName: "plus.square.on.square")) { _ in
        self?.browser?.open(linkURL, inNewTab: true)
      }
      let openBackground = UIAction(title: "Open in Background", image: UIImage(systemName: "square.on.square")) { _ in
        self?.browser?.openInBackground(linkURL)
      }
      return UIMenu(children: [UIMenu(options: .displayInline, children: [openNew, openBackground])] + suggested)
    }
  }
}
