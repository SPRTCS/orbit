import WebKit

final class WebViewFactory {
  static let applicationNameForUserAgent = "Version/26.0 Mobile/15E148 Safari/604.1"

  private var spare: WKWebView?
  private var prewarmTask: Task<Void, Never>?

  func makeConfiguration() -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.allowsInlineMediaPlayback = true
    configuration.allowsPictureInPictureMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = .audio
    configuration.applicationNameForUserAgent = Self.applicationNameForUserAgent
    configuration.defaultWebpagePreferences.preferredContentMode = .recommended
    return configuration
  }

  func makeWebView(configuration: WKWebViewConfiguration? = nil) -> WKWebView {
    if configuration == nil, let spare {
      self.spare = nil
      schedulePrewarm()
      return spare
    }
    let webView = OrbitWebView(frame: .zero, configuration: configuration ?? makeConfiguration())
    configure(webView)
    if configuration == nil { schedulePrewarm() }
    return webView
  }

  func schedulePrewarm(after delay: Duration = .milliseconds(800)) {
    guard spare == nil, prewarmTask == nil else { return }
    prewarmTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      self.prewarmTask = nil
      guard self.spare == nil else { return }
      let webView = OrbitWebView(frame: .zero, configuration: self.makeConfiguration())
      self.configure(webView)
      self.spare = webView
    }
  }

  func dropSpare() {
    prewarmTask?.cancel()
    prewarmTask = nil
    spare = nil
  }

  private func configure(_ webView: WKWebView) {
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsLinkPreview = true
    webView.isFindInteractionEnabled = true
    webView.scrollView.keyboardDismissMode = .interactive
    webView.backgroundColor = .systemBackground
    #if DEBUG
      webView.isInspectable = true
    #endif
  }
}

final class OrbitWebView: WKWebView {
  var ignoresSafeArea = false {
    didSet {
      guard oldValue != ignoresSafeArea else { return }
      scrollView.contentInsetAdjustmentBehavior = ignoresSafeArea ? .never : .automatic
      safeAreaInsetsDidChange()
      setNeedsLayout()
    }
  }

  override var safeAreaInsets: UIEdgeInsets {
    ignoresSafeArea ? .zero : Self.sharedHorizontalInsets(super.safeAreaInsets)
  }

  static func sharedHorizontalInsets(_ insets: UIEdgeInsets) -> UIEdgeInsets {
    let horizontal = min(insets.left, insets.right)
    return UIEdgeInsets(top: insets.top, left: horizontal, bottom: insets.bottom, right: horizontal)
  }
}
