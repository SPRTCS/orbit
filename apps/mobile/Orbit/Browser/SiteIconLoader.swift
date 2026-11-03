import UIKit

nonisolated enum SiteIconLinks {
  struct Candidate: Equatable {
    let url: URL
    let score: Int
  }

  static func origin(of url: URL?) -> URL? {
    guard let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", let host = url.host() else {
      return nil
    }
    return URL(string: "\(scheme)://\(host)/")
  }

  static func candidates(html: String, base: URL) -> [URL] {
    var found: [Candidate] = []
    let tags = html.matches(of: /<link\b[^>]*>/.ignoresCase())
    for tag in tags {
      let text = String(tag.output)
      guard let rel = attribute("rel", in: text)?.lowercased(), let href = attribute("href", in: text),
        let url = URL(string: href.trimmingCharacters(in: .whitespaces), relativeTo: base)?.absoluteURL,
        url.scheme?.hasPrefix("http") == true, !url.path().lowercased().hasSuffix(".svg")
      else { continue }
      let words = Set(rel.split(separator: " ").map(String.init))
      if words.contains("mask-icon") || attribute("type", in: text)?.lowercased().contains("svg") == true { continue }
      let size = largestSize(attribute("sizes", in: text))
      if words.contains("apple-touch-icon") || words.contains("apple-touch-icon-precomposed") {
        found.append(Candidate(url: url, score: 10_000 + (size ?? 180)))
      } else if words.contains("icon") {
        found.append(Candidate(url: url, score: size ?? 32))
      }
    }
    var seen = Set<URL>()
    return found.sorted { $0.score > $1.score }.map(\.url).filter { seen.insert($0).inserted }
  }

  static func fallbacks(for origin: URL) -> [URL] {
    ["apple-touch-icon.png", "favicon.ico"].compactMap { URL(string: $0, relativeTo: origin)?.absoluteURL }
  }

  private static func attribute(_ name: String, in tag: String) -> String? {
    let pattern = try? Regex<(Substring, Substring?, Substring?, Substring?)>(
      #"\b"# + name + #"\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#)
    guard let pattern, let match = tag.firstMatch(of: pattern.ignoresCase()) else { return nil }
    return (match.output.1 ?? match.output.2 ?? match.output.3).map(String.init)
  }

  private static func largestSize(_ sizes: String?) -> Int? {
    guard let sizes else { return nil }
    if sizes.lowercased() == "any" { return nil }
    return sizes.split(separator: " ").compactMap { Int($0.lowercased().split(separator: "x").first ?? "") }.max()
  }
}

actor SiteIconLoader {
  static let shared = SiteIconLoader()
  static let minimumPixels: CGFloat = 16

  private var cache: [URL: UIImage?] = [:]
  private var inflight: [URL: Task<UIImage?, Never>] = [:]

  func icon(for url: URL?) async -> UIImage? {
    guard let origin = SiteIconLinks.origin(of: url) else { return nil }
    if let cached = cache[origin] { return cached }
    if let running = inflight[origin] { return await running.value }
    let task = Task { await Self.fetch(origin: origin) }
    inflight[origin] = task
    let image = await task.value
    cache[origin] = image
    inflight[origin] = nil
    return image
  }

  private nonisolated static func fetch(origin: URL) async -> UIImage? {
    var candidates: [URL] = []
    if let html = await page(origin) { candidates += SiteIconLinks.candidates(html: html, base: origin) }
    candidates += SiteIconLinks.fallbacks(for: origin).filter { !candidates.contains($0) }
    for candidate in candidates.prefix(6) {
      if let image = await image(candidate) { return image }
    }
    return nil
  }

  private nonisolated static func page(_ url: URL) async -> String? {
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.setValue("text/html", forHTTPHeaderField: "Accept")
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      (response as? HTTPURLResponse)?.statusCode ?? 0 < 400
    else { return nil }
    let head = data.prefix(256 * 1024)
    return String(data: head, encoding: .utf8) ?? String(data: head, encoding: .isoLatin1)
  }

  private nonisolated static func image(_ url: URL) async -> UIImage? {
    guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
      (response as? HTTPURLResponse)?.statusCode ?? 0 < 400, let image = UIImage(data: data),
      image.size.width * image.scale >= minimumPixels, image.size.height * image.scale >= minimumPixels
    else { return nil }
    return image
  }
}
