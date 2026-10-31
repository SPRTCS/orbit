import Foundation

enum RecoveryPhrase {
  static let expectedWordCount = 24

  static func words(in text: String) -> [String] {
    phraseSource(in: text).lowercased().split { !$0.isLetter }.map(String.init)
  }

  static func normalized(_ text: String) -> String {
    words(in: text).joined(separator: " ")
  }

  private static let phraseKeys: Set<String> = ["phrase", "words", "mnemonic", "recoveryphrase", "recovery_phrase"]

  private static func phraseSource(in text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if let data = trimmed.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      for (key, value) in object where phraseKeys.contains(key.lowercased()) {
        if let string = value as? String { return string }
        if let list = value as? [String] { return list.joined(separator: " ") }
      }
    }
    if let components = URLComponents(string: trimmed), components.scheme != nil,
      let value = components.queryItems?.first(where: { phraseKeys.contains($0.name.lowercased()) })?.value
    {
      return value
    }
    return trimmed
  }
}
