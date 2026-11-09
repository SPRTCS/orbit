import Foundation

@Observable
final class AppSettings {
  private enum Key {
    static let searchEngine = "searchEngine"
    static let searchSuggestions = "searchSuggestionsEnabled"
    static let deviceName = "deviceName"
    static let siteModes = "siteModes"
    static let pageZooms = "pageZooms"
  }

  @ObservationIgnored private let defaults: UserDefaults

  var searchEngine: SearchEngine {
    didSet { defaults.set(searchEngine.rawValue, forKey: Key.searchEngine) }
  }

  var searchSuggestionsEnabled: Bool {
    didSet { defaults.set(searchSuggestionsEnabled, forKey: Key.searchSuggestions) }
  }

  var deviceName: String? {
    didSet { defaults.set(deviceName, forKey: Key.deviceName) }
  }

  private(set) var siteModes: [String: String] {
    didSet { defaults.set(siteModes, forKey: Key.siteModes) }
  }

  private(set) var pageZooms: [String: Double] {
    didSet { defaults.set(pageZooms, forKey: Key.pageZooms) }
  }

  func siteMode(forHost host: String) -> SiteMode? {
    siteModes[host].flatMap(SiteMode.init(rawValue:))
  }

  func setSiteMode(_ mode: SiteMode?, forHost host: String) {
    siteModes[host] = mode?.rawValue
  }

  func pageZoom(forHost host: String) -> Double {
    pageZooms[host] ?? 1
  }

  func setPageZoom(_ zoom: Double, forHost host: String) {
    pageZooms[host] = abs(zoom - 1) < 0.001 ? nil : zoom
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    siteModes = defaults.dictionary(forKey: Key.siteModes) as? [String: String] ?? [:]
    pageZooms = defaults.dictionary(forKey: Key.pageZooms) as? [String: Double] ?? [:]
    searchEngine = defaults.string(forKey: Key.searchEngine).flatMap(SearchEngine.init(rawValue:)) ?? .google
    searchSuggestionsEnabled = defaults.object(forKey: Key.searchSuggestions) as? Bool ?? true
    deviceName = defaults.string(forKey: Key.deviceName)
  }
}
