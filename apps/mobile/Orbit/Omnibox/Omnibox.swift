import Foundation

enum Omnibox {
  enum Resolution: Equatable {
    case url(URL)
    case search(String)
  }

  static func resolve(_ raw: String) -> Resolution? {
    let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !input.isEmpty else { return nil }
    if input.hasPrefix("?") {
      let query = String(input.dropFirst()).trimmingCharacters(in: .whitespaces)
      return query.isEmpty ? nil : .search(query)
    }
    if let url = fixup(input) { return .url(url) }
    return .search(input)
  }

  static func url(for raw: String, engine: SearchEngine) -> URL? {
    switch resolve(raw) {
    case .url(let url): url
    case .search(let query): engine.searchURL(for: query)
    case nil: nil
    }
  }

  static func fixup(_ raw: String) -> URL? {
    let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !input.isEmpty else { return nil }
    if input.contains(where: \.isWhitespace), !matches(input, "^[a-z][a-z0-9+.-]*://") { return nil }
    if matches(input, "^(about|data|mailto|tel|sms|facetime):") { return makeURL(input) }

    let scheme = firstGroup(in: input, "^([a-z][a-z0-9+.-]*):")?.lowercased()
    if let scheme {
      let afterColon = input.dropFirst(scheme.count + 1)
      if knownSchemes.contains(scheme), afterColon.hasPrefix("//") || !(afterColon.first?.isNumber ?? false) {
        return makeURL(scheme + input.dropFirst(scheme.count).replacingOccurrences(of: " ", with: "%20"))
      }
      if !knownSchemes.contains(scheme), afterColon.hasPrefix("//") { return makeURL(input) }
    }

    guard input.contains(where: { ".:/?#[".contains($0) }) else {
      return input.lowercased() == "localhost" ? makeURL("http://localhost") : nil
    }
    guard let match = hostPattern.firstMatch(in: input, range: NSRange(input.startIndex..., in: input)),
      let hostRange = Range(match.range(at: 1), in: input),
      let matchRange = Range(match.range, in: input)
    else { return nil }

    var name = input[hostRange].lowercased()
    if name.hasSuffix(".") { name.removeLast() }
    let numeric = !name.isEmpty && name.allSatisfy { $0.isASCII && ($0.isNumber || $0 == ".") }
    if numeric, !name.contains(".") { return nil }
    let bracketed = name.hasPrefix("[")
    let dotted = name.contains(".") && !numeric && !bracketed
    let tld = dotted ? String(name[name.index(after: name.lastIndex(of: ".")!)...]) : ""
    let rest = String(input[matchRange.upperBound...])
    let special = name == "localhost" || bracketed || numeric
    let proto = isLocalHost(name) ? "http" : "https"
    if special || (dotted && (knownTLDs.contains(tld) || tld.hasPrefix("xn--"))) {
      return makeURL("\(proto)://\(input)")
    }
    let hasPort = match.range(at: 5).location != NSNotFound
    if !hasPort, !rest.contains("/"), !rest.contains("?"), !rest.contains("#") { return nil }
    let path = String(rest.prefix { $0 != "?" && $0 != "#" })
    let afterPath = rest.dropFirst(path.count)
    let query = afterPath.hasPrefix("?") ? String(afterPath.prefix { $0 != "#" }) : ""
    let fragment = rest.firstIndex(of: "#").map { String(rest[$0...]) } ?? ""
    let parts = (hasPort ? 1 : 0) + (path.isEmpty ? 0 : 1) + (query.count > 1 ? 1 : 0) + (fragment.count > 1 ? 1 : 0)
    return hasPort || path.hasSuffix("/") || parts > 1 ? makeURL("\(proto)://\(input)") : nil
  }

  static func displayHost(_ url: URL) -> String {
    guard let host = url.host(percentEncoded: false), !host.isEmpty else {
      return url.absoluteString
    }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  static func editingText(for url: URL) -> String {
    SearchEngine.query(fromResultsPage: url) ?? url.absoluteString
  }

  static func matchKey(_ url: URL) -> String {
    var text = url.absoluteString.lowercased()
    for prefix in ["https://", "http://"] where text.hasPrefix(prefix) { text.removeFirst(prefix.count) }
    if text.hasPrefix("www.") { text.removeFirst(4) }
    if text.hasSuffix("/") { text.removeLast() }
    return text
  }

  private static func makeURL(_ string: String) -> URL? {
    URL(string: string, encodingInvalidCharacters: true)
  }

  private static func isLocalHost(_ host: String) -> Bool {
    host == "localhost" || !host.contains(".") || host.hasPrefix("[")
      || matches(host, "^(\\d{1,3}\\.){3}\\d{1,3}$")
      || matches(host, "\\.(local|localhost|test|internal|lan|home\\.arpa)$")
  }

  private static func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
  }

  private static func firstGroup(in text: String, _ pattern: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
      let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
      let range = Range(match.range(at: 1), in: text)
    else { return nil }
    return String(text[range])
  }

  private static let labelChars = "a-z0-9\\u00a1-\\uffff"
  private static let label = "[\(labelChars)](?:[\(labelChars)-]*[\(labelChars)])?"
  private static let hostPattern = try! NSRegularExpression(
    pattern:
      "^(localhost|\\[[0-9a-f:.]+\\]|(\\d{1,3}\\.){3}\\d{1,3}|(\(label)\\.)+([a-z\\u00a1-\\uffff](?:[\(labelChars)-]*[\(labelChars)])?|xn--[a-z0-9-]+)|\(label))\\.?(:\\d{1,5})?(?=[/?#]|$)",
    options: .caseInsensitive)

  private static let knownSchemes: Set<String> = [
    "http", "https", "file", "about", "data", "blob", "mailto", "tel", "sms", "facetime", "ftp", "view-source",
    "itms-apps", "itms-services", "maps", "slack", "zoommtg", "notion", "figma", "spotify", "linear", "obsidian",
  ]

  private static let knownTLDs: Set<String> = Set(
    ("com net org edu gov mil int info biz name pro mobi app dev io ai co me tv cc gg sh fm ly so to xyz online site tech store "
      + "blog shop cloud page news live art design studio agency media digital network systems solutions services software "
      + "email chat social link click space website world today life fun games game zone wiki tools codes run build host "
      + "rocks ninja guru expert academy school university health care money finance bank capital fund law legal travel "
      + "photos photo pics gallery video music film movie radio audio events group team community church city "
      + "london nyc paris berlin tokyo africa asia eu aero coop museum jobs cat post tel moe onl one top vip win "
      + "work works company business center global plus inc ltd llc gmbh srl cafe restaurant pizza bar pub coffee wine beer "
      + "fashion style shoes clothing jewelry watch camera computer phone mobile download security domains hosting "
      + "google youtube gmail android chrome amazon apple microsoft windows office azure aws netflix meta search "
      + "local localhost test internal lan arpa onion "
      + "ac ad ae af ag al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca "
      + "cd cf cg ch ci ck cl cm cn cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et fi fj fk fo fr ga "
      + "gd ge gf gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in iq ir is it je jm jo jp "
      + "ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ma mc md mg mh mk ml mm mn mo mp mq mr ms "
      + "mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro "
      + "rs ru rw sa sb sc sd se sg si sk sl sm sn sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn tr tt "
      + "tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw").split(separator: " ").map(String.init))
}
