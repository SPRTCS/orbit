import Foundation

@Observable
final class AppSettings {
  private enum Key {
    static let searchEngine = "searchEngine"
    static let searchSuggestions = "searchSuggestionsEnabled"
    static let deviceName = "deviceName"
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

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    searchEngine = defaults.string(forKey: Key.searchEngine).flatMap(SearchEngine.init(rawValue:)) ?? .google
    searchSuggestionsEnabled = defaults.object(forKey: Key.searchSuggestions) as? Bool ?? true
    deviceName = defaults.string(forKey: Key.deviceName)
  }
}
