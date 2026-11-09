import SwiftUI
import WebKit

struct ReaderArticle: Identifiable, Equatable {
  let id = UUID()
  let url: URL
  let title: String
  let byline: String?
  let siteName: String?
  let content: String
  let isRightToLeft: Bool
  let isPrivate: Bool

  static func escaped(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
  }

  var html: String {
    let credits = [byline, siteName ?? Omnibox.displayHost(url)].compactMap { $0 }.filter { !$0.isEmpty }
      .map(Self.escaped).joined(separator: " · ")
    return """
      <!doctype html><html dir="\(isRightToLeft ? "rtl" : "ltr")"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
      :root { color-scheme: light dark; }
      body { font: -apple-system-body; font-family: "New York", ui-serif, Georgia, serif; line-height: 1.6;
        max-width: 42em; margin: 0 auto; padding: 28px 22px 96px; overflow-wrap: break-word; }
      h1 { font-size: 1.7em; line-height: 1.2; margin: 0 0 0.3em; }
      h2, h3 { line-height: 1.3; margin-top: 1.6em; }
      .credits { color: gray; font-family: -apple-system, sans-serif; font-size: 0.8em; margin: 0 0 2em; }
      img, video, figure, iframe, table { max-width: 100%; height: auto; }
      figure { margin: 1.5em 0; } figcaption { color: gray; font-size: 0.8em; }
      a { color: inherit; } pre { overflow-x: auto; font-size: 0.8em; } blockquote { border-inline-start: 3px solid gray;
        margin-inline: 0; padding-inline-start: 1em; color: gray; }
      </style></head><body><h1>\(Self.escaped(title))</h1><p class="credits">\(credits)</p>\(content)</body></html>
      """
  }
}

enum ReaderExtractor {
  static let world = WKContentWorld.world(name: "OrbitReader")

  static let librarySource: String? = Bundle.main.url(forResource: "Readability", withExtension: "js")
    .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

  static let extraction = """
    const parsed = new Readability(document.cloneNode(true)).parse();
    if (!parsed || !parsed.content || (parsed.textContent || "").trim().length < 200) return null;
    return { title: parsed.title || document.title || "", byline: parsed.byline || "", siteName: parsed.siteName || "",
      content: parsed.content, dir: parsed.dir || document.dir || "" };
    """

  static func extract(from webView: WKWebView, url: URL, isPrivate: Bool) async -> ReaderArticle? {
    guard let librarySource else { return nil }
    let result = try? await webView.callAsyncJavaScript(
      librarySource + "\n" + extraction, arguments: [:], in: nil, contentWorld: world)
    guard let fields = result as? [String: Any], let content = fields["content"] as? String else { return nil }
    let byline = (fields["byline"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let siteName = (fields["siteName"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return ReaderArticle(
      url: url, title: fields["title"] as? String ?? "", byline: byline, siteName: siteName, content: content,
      isRightToLeft: (fields["dir"] as? String)?.lowercased() == "rtl", isPrivate: isPrivate)
  }
}

struct ReaderView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.dismiss) private var dismiss
  let article: ReaderArticle
  @AppStorage("readerTextScale") private var textScale = 1.0

  var body: some View {
    NavigationStack {
      ReaderWebView(article: article, textScale: textScale) { url in
        dismiss()
        browser.open(url, inNewTab: false)
      }
      .ignoresSafeArea(edges: .bottom)
      .navigationTitle(article.siteName ?? Omnibox.displayHost(article.url))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
          Button("Smaller Text", systemImage: "textformat.size.smaller") {
            textScale = PageZoom.stepped(textScale, by: -1)
          }
          .disabled(textScale <= 0.75)
          Button("Larger Text", systemImage: "textformat.size.larger") {
            textScale = PageZoom.stepped(textScale, by: 1)
          }
          .disabled(textScale >= 2)
          ShareLink(item: article.url)
        }
      }
    }
  }
}

struct ReaderWebView: UIViewRepresentable {
  let article: ReaderArticle
  let textScale: Double
  let open: (URL) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(open: open)
  }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    if article.isPrivate { configuration.websiteDataStore = .nonPersistent() }
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.isOpaque = false
    webView.backgroundColor = .systemBackground
    webView.pageZoom = textScale
    webView.loadHTMLString(article.html, baseURL: article.url)
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    context.coordinator.open = open
    if abs(webView.pageZoom - textScale) > 0.001 { webView.pageZoom = textScale }
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var open: (URL) -> Void

    init(open: @escaping (URL) -> Void) {
      self.open = open
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async
      -> WKNavigationActionPolicy
    {
      guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return .allow }
      if url.scheme == "http" || url.scheme == "https" { open(url) }
      return .cancel
    }
  }
}
