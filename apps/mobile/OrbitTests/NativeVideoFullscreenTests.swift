import Testing
import WebKit

@testable import Orbit

@MainActor
struct NativeVideoFullscreenTests {
  private func loadedWebView() async throws -> WKWebView {
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: WebViewFactory().makeConfiguration(dataStore: .nonPersistent()))
    let navigation = NavigationWaiter()
    webView.navigationDelegate = navigation
    webView.loadHTMLString("<div id=player><video id=clip></video></div><p id=text>text</p>", baseURL: URL(string: "https://example.com/"))
    try await navigation.finished()
    return webView
  }

  @Test func pagesSeeFullscreenSupport() async throws {
    let webView = try await loadedWebView()
    let enabled = try await webView.callAsyncJavaScript("return document.fullscreenEnabled === true && typeof document.body.requestFullscreen === 'function'", contentWorld: .page)
    #expect(enabled as? Bool == true)
  }

  @Test func elementsWithoutVideoStillRefuseFullscreen() async throws {
    let webView = try await loadedWebView()
    let outcome = try await webView.callAsyncJavaScript(
      "try { await document.getElementById('text').requestFullscreen(); return 'resolved'; } catch (error) { return 'rejected'; }",
      contentWorld: .page)
    #expect(outcome as? String == "rejected")
    let element = try await webView.callAsyncJavaScript("return document.fullscreenElement === null", contentWorld: .page)
    #expect(element as? Bool == true)
  }
}

@MainActor
private final class NavigationWaiter: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, Error>?
  private var done = false

  func finished() async throws {
    if done { return }
    try await withCheckedThrowingContinuation { continuation = $0 }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    done = true
    continuation?.resume()
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    done = true
    continuation?.resume(throwing: error)
    continuation = nil
  }
}
