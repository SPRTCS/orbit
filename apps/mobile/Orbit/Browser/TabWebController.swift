import UIKit
import WebKit

final class TabWebController: NSObject, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {
  let webView: WKWebView
  private weak var tab: BrowserTab?
  private weak var browser: BrowserModel?
  private var observations: [NSKeyValueObservation] = []
  private let refreshControl = UIRefreshControl()
  private let overviewPinch = UIPinchGestureRecognizer()
  private var pinchStartCentroid: CGPoint = .zero
  private var pinchDrivesOverview = false
  private var lastOffsetY: CGFloat = 0
  private var directionTravel: CGFloat = 0

  private static let collapseTravel: CGFloat = 24
  private static let expandTravel: CGFloat = 36
  private static let minimumScrollableHeight: CGFloat = 120
  private static let bottomMargin: CGFloat = 44

  private static let embeddedSchemes: Set<String> = ["http", "https", "about", "data", "blob", "file", "javascript"]
  private static let storeSchemes: Set<String> = ["itms-apps", "itms-appss"]

  init(webView: WKWebView, tab: BrowserTab, browser: BrowserModel) {
    self.webView = webView
    self.tab = tab
    self.browser = browser
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    overviewPinch.addTarget(self, action: #selector(handleOverviewPinch(_:)))
    overviewPinch.delegate = self
    webView.addGestureRecognizer(overviewPinch)
    refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
    webView.scrollView.refreshControl = refreshControl
    observeWebView()
    syncState()
  }

  func tearDown() {
    webView.removeGestureRecognizer(overviewPinch)
    observations.removeAll()
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
      webView.scrollView.observe(\.contentOffset) { [weak self] _, _ in
        MainActor.assumeIsolated { self?.scrollViewDidScroll() }
      },
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

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === overviewPinch else { return true }
    let scrollView = webView.scrollView
    return scrollView.zoomScale <= scrollView.minimumZoomScale + 0.01 && browser?.morph.isActive == false
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    gestureRecognizer === overviewPinch
  }

  @objc private func handleOverviewPinch(_ pinch: UIPinchGestureRecognizer) {
    guard let browser else { return }
    let centroid = pinch.location(in: webView.window)
    switch pinch.state {
    case .began:
      pinchStartCentroid = centroid
      pinchDrivesOverview = false
    case .changed:
      if !pinchDrivesOverview {
        guard OverviewMorph.pinchStartsOverview(scale: pinch.scale) else { return }
        pinchDrivesOverview = browser.beginInteractiveOverview()
        pinchStartCentroid = centroid
        guard pinchDrivesOverview else { return }
      }
      let progress = OverviewMorph.pinchProgress(scale: pinch.scale, targetScale: browser.morph.pinchTargetScale)
      let translation = CGSize(width: centroid.x - pinchStartCentroid.x, height: centroid.y - pinchStartCentroid.y)
      browser.updateInteractiveOverview(progress, translation: translation)
    case .ended:
      guard pinchDrivesOverview else { return }
      pinchDrivesOverview = false
      let progress = OverviewMorph.pinchProgress(scale: pinch.scale, targetScale: browser.morph.pinchTargetScale)
      browser.endInteractiveOverview(commit: OverviewMorph.shouldCommit(progress: progress, velocity: -pinch.velocity))
    case .cancelled, .failed:
      guard pinchDrivesOverview else { return }
      pinchDrivesOverview = false
      browser.endInteractiveOverview(commit: false)
    default:
      break
    }
  }

  private func scrollViewDidScroll() {
    let scrollView = webView.scrollView
    let offset = scrollView.contentOffset.y
    let delta = offset - lastOffsetY
    lastOffsetY = offset
    guard scrollView.isTracking || scrollView.isDecelerating, let browser else {
      directionTravel = 0
      return
    }
    let top = -scrollView.adjustedContentInset.top
    let bottom = scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom
    guard bottom - top > Self.minimumScrollableHeight else {
      browser.setChromeCollapsed(false)
      return
    }
    if offset <= top + 2 || offset >= bottom - 2 {
      directionTravel = 0
      browser.setChromeCollapsed(false)
      return
    }
    guard delta != 0 else { return }
    if (delta > 0) != (directionTravel > 0) { directionTravel = 0 }
    directionTravel += delta
    if directionTravel > Self.collapseTravel, offset < bottom - Self.bottomMargin {
      browser.setChromeCollapsed(true)
    } else if directionTravel < -Self.expandTravel {
      browser.setChromeCollapsed(false)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences
  ) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
    let policy = await policy(for: navigationAction)
    if policy == .allow, navigationAction.targetFrame?.isMainFrame == true, let url = navigationAction.request.url,
      let browser
    {
      let mode = browser.siteMode(for: url, in: tab)
      preferences.preferredContentMode = mode.contentMode
      if webView.customUserAgent != mode.userAgent { webView.customUserAgent = mode.userAgent }
    }
    return (policy, preferences)
  }

  private func policy(for navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    if navigationAction.shouldPerformDownload { return .download }
    guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return .allow }
    if scheme.hasPrefix("itms"), !Self.storeSchemes.contains(scheme) { return .cancel }
    if !Self.embeddedSchemes.contains(scheme) {
      _ = await UIApplication.shared.open(url)
      return .cancel
    }
    if navigationAction.navigationType == .linkActivated, navigationAction.modifierFlags.contains(.command) {
      browser?.openInBackground(url, isPrivate: tab?.isPrivate == true)
      return .cancel
    }
    return .allow
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async
    -> WKNavigationResponsePolicy
  {
    let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
    let download = DownloadPolicy.shouldDownload(
      canShowMIMEType: navigationResponse.canShowMIMEType, contentDisposition: disposition,
      isMainFrame: navigationResponse.isForMainFrame)
    return download ? .download : .allow
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    browser?.beginDownload(download, source: navigationAction.request.url)
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    browser?.beginDownload(download, source: navigationResponse.response.url)
  }

  func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async
    -> (URLSession.AuthChallengeDisposition, URLCredential?)
  {
    let space = challenge.protectionSpace
    let passwordMethods = [NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLAuthenticationMethodNTLM]
    guard passwordMethods.contains(space.authenticationMethod), let tab, browser?.selectedTabID == tab.id else {
      return (.performDefaultHandling, nil)
    }
    if challenge.previousFailureCount == 0, let proposed = challenge.proposedCredential, proposed.hasPassword {
      return (.useCredential, proposed)
    }
    guard challenge.previousFailureCount < 3,
      let credential = await UIKitPresenter.credentials(
        host: space.host, realm: space.realm, retrying: challenge.previousFailureCount > 0)
    else { return (.cancelAuthenticationChallenge, nil) }
    return (.useCredential, credential)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tab?.loadError = nil
    tab?.failedURL = nil
    syncState()
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    syncState()
    directionTravel = 0
    if let tab { browser?.applyPageZoom(to: tab) }
    if let tab, browser?.selectedTabID == tab.id { browser?.setChromeCollapsed(false) }
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
    if webView.url != nil {
      webView.reload()
    } else if let url = tab?.url {
      webView.load(URLRequest(url: url))
    }
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    browser?.openPopup(configuration: configuration, isPrivate: tab?.isPrivate == true)
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
      let openNew = UIAction(title: String(localized: "Open in New Tab"), image: UIImage(systemName: "plus.square.on.square")) { _ in
        self?.browser?.open(linkURL, inNewTab: true, isPrivate: self?.tab?.isPrivate == true)
      }
      let openBackground = UIAction(title: String(localized: "Open in Background"), image: UIImage(systemName: "square.on.square")) { _ in
        self?.browser?.openInBackground(linkURL, isPrivate: self?.tab?.isPrivate == true)
      }
      let download = UIAction(title: String(localized: "Download Linked File"), image: UIImage(systemName: "arrow.down.circle")) { _ in
        self?.browser?.download(linkURL, from: self?.tab)
      }
      return UIMenu(children: [UIMenu(options: .displayInline, children: [openNew, openBackground, download])] + suggested)
    }
  }
}
