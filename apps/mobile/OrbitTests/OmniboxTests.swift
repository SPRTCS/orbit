import Foundation
import Testing

@testable import Orbit

struct OmniboxTests {
  @Test(arguments: [
    ("google.de", "https://google.de"),
    ("apple.com/iphone", "https://apple.com/iphone"),
    ("www.example.org", "https://www.example.org"),
    ("example.com:8080", "https://example.com:8080"),
    ("localhost", "http://localhost"),
    ("localhost:3000", "http://localhost:3000"),
    ("192.168.1.10", "http://192.168.1.10"),
    ("192.168.1.10:8080/admin", "http://192.168.1.10:8080/admin"),
    ("printer.local", "http://printer.local"),
    ("https://example.com/a b", "https://example.com/a%20b"),
    ("HTTPS://Example.com", "https://Example.com"),
    ("mailto:hello@example.com", "mailto:hello@example.com"),
    ("about:blank", "about:blank"),
    ("xn--bcher-kva.de", "https://xn--bcher-kva.de"),
    ("intranet/", "http://intranet/"),
    ("news.ycombinator.com/item?id=1", "https://news.ycombinator.com/item?id=1"),
  ])
  func resolvesURLs(input: String, expected: String) {
    #expect(Omnibox.resolve(input) == .url(URL(string: expected)!))
  }

  @Test(arguments: [
    "swift concurrency",
    "what is 2+2",
    "hello",
    "1.5",
    "user@example.com",
    "foo.notarealtld",
    "c++",
    "how to use example.com",
  ])
  func resolvesSearches(input: String) {
    #expect(Omnibox.resolve(input) == .search(input))
  }

  @Test func questionMarkForcesSearch() {
    #expect(Omnibox.resolve("?apple.com") == .search("apple.com"))
    #expect(Omnibox.resolve("?") == nil)
  }

  @Test func emptyInputResolvesToNothing() {
    #expect(Omnibox.resolve("   ") == nil)
    #expect(Omnibox.url(for: "", engine: .google) == nil)
  }

  @Test func searchURLsEncodeTheQuery() {
    #expect(
      SearchEngine.google.searchURL(for: "c++ & swift").absoluteString
        == "https://www.google.com/search?q=c%2B%2B%20%26%20swift")
    #expect(SearchEngine.duckDuckGo.searchURL(for: "orbit").absoluteString == "https://duckduckgo.com/?q=orbit")
    #expect(SearchEngine.bing.searchURL(for: "orbit").absoluteString == "https://www.bing.com/search?q=orbit")
    #expect(SearchEngine.ecosia.searchURL(for: "orbit").absoluteString == "https://www.ecosia.org/search?q=orbit")
  }

  @Test func searchesUseTheChosenEngine() {
    #expect(Omnibox.url(for: "orbit browser", engine: .ecosia)?.absoluteString == "https://www.ecosia.org/search?q=orbit%20browser")
    #expect(Omnibox.url(for: "orbit.dev", engine: .ecosia)?.absoluteString == "https://orbit.dev")
  }

  @Test func readsQueriesBackFromResultsPages() {
    #expect(SearchEngine.query(fromResultsPage: URL(string: "https://www.google.de/search?q=swift%20ui&hl=de")!) == "swift ui")
    #expect(SearchEngine.query(fromResultsPage: URL(string: "https://duckduckgo.com/?q=orbit")!) == "orbit")
    #expect(SearchEngine.query(fromResultsPage: URL(string: "https://www.bing.com/search?q=orbit")!) == "orbit")
    #expect(SearchEngine.query(fromResultsPage: URL(string: "https://example.com/search?q=orbit")!) == nil)
  }

  @Test func editingTextShowsQueryOrURL() {
    #expect(Omnibox.editingText(for: URL(string: "https://www.google.com/search?q=orbit")!) == "orbit")
    #expect(Omnibox.editingText(for: URL(string: "https://apple.com/mac")!) == "https://apple.com/mac")
  }

  @Test func parsesOpenSearchSuggestions() {
    let data = Data(#"["orb",["orbit","orbital mechanics",""]]"#.utf8)
    #expect(SearchEngine.parseSuggestions(data) == ["orbit", "orbital mechanics"])
    #expect(SearchEngine.parseSuggestions(Data("garbage".utf8)).isEmpty)
  }

  @Test func displayHostDropsWWW() {
    #expect(Omnibox.displayHost(URL(string: "https://www.apple.com/mac")!) == "apple.com")
    #expect(Omnibox.matchKey(URL(string: "https://www.apple.com/")!) == "apple.com")
  }

  @Test func normalizesRecoveryPhrases() {
    let numbered = (1...24).map { "\($0). word" }.joined(separator: "\n")
    #expect(RecoveryPhrase.words(in: numbered).count == 24)
    #expect(RecoveryPhrase.normalized("  Apple,  BANANA\ncherry ") == "apple banana cherry")
    #expect(RecoveryPhrase.normalized(#"{"phrase":"one two three"}"#) == "one two three")
    #expect(RecoveryPhrase.normalized("orbit://recovery?phrase=one%20two%20three") == "one two three")
  }
}
