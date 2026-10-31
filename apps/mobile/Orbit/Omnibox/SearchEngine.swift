import Foundation

enum SearchEngine: String, CaseIterable, Identifiable, Codable, Sendable {
  case google
  case duckDuckGo
  case bing
  case ecosia

  var id: String { rawValue }

  var name: String {
    switch self {
    case .google: "Google"
    case .duckDuckGo: "DuckDuckGo"
    case .bing: "Bing"
    case .ecosia: "Ecosia"
    }
  }

  private var searchBase: String {
    switch self {
    case .google: "https://www.google.com/search?q="
    case .duckDuckGo: "https://duckduckgo.com/?q="
    case .bing: "https://www.bing.com/search?q="
    case .ecosia: "https://www.ecosia.org/search?q="
    }
  }

  private var suggestBase: String {
    switch self {
    case .google: "https://suggestqueries.google.com/complete/search?client=firefox&q="
    case .duckDuckGo: "https://duckduckgo.com/ac/?type=list&q="
    case .bing: "https://api.bing.com/osjson.aspx?query="
    case .ecosia: "https://ac.ecosia.org/autocomplete?type=list&q="
    }
  }

  func searchURL(for query: String) -> URL {
    URL(string: searchBase + Self.encodeQueryValue(query.trimmingCharacters(in: .whitespacesAndNewlines)))!
  }

  func suggestURL(for query: String) -> URL {
    URL(string: suggestBase + Self.encodeQueryValue(query))!
  }

  static func encodeQueryValue(_ value: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
  }

  static func query(fromResultsPage url: URL) -> String? {
    guard let host = url.host()?.lowercased(),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return nil }
    let bareHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    let path = components.path
    let isResultsPage =
      (bareHost.hasPrefix("google.") && path == "/search")
      || (bareHost == "duckduckgo.com" && (path == "/" || path.isEmpty))
      || (bareHost == "bing.com" && path == "/search")
      || (bareHost == "ecosia.org" && path == "/search")
    guard isResultsPage else { return nil }
    let query = components.queryItems?.first { $0.name == "q" }?.value
    return query?.isEmpty == false ? query : nil
  }

  static func parseSuggestions(_ data: Data) -> [String] {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [Any], root.count >= 2,
      let list = root[1] as? [Any]
    else { return [] }
    return list.compactMap { $0 as? String }.filter { !$0.isEmpty }
  }
}
