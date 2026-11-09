import Foundation
import OrbitSync

enum SyncMessage {
  private static let unknownWordPrefix = "“"
  private static let unknownWordSuffix = "” is not a valid recovery phrase word."

  static func localized(_ message: String) -> String {
    switch message {
    case OrbitSyncClient.outOfSyncMessage:
      return String(localized: "This device is out of sync. Sync may have been reset from another device.")
    case OrbitSyncClient.folderUnavailableMessage:
      return String(localized: "The sync folder isn’t available. Check iCloud Drive, or choose the folder again.")
    case OrbitSyncClient.disconnectFailedMessage:
      return String(localized: "Couldn’t disconnect: this device’s sync state can’t be saved.")
    case "That folder can’t be opened.":
      return String(localized: "That folder can’t be opened.")
    case "Couldn’t save the sync key in the Keychain.":
      return String(localized: "Couldn’t save the sync key in the Keychain.")
    case "Couldn’t save this device’s sync state.":
      return String(localized: "Couldn’t save this device’s sync state.")
    case "Recovery phrase must be exactly 24 words.":
      return String(localized: "Recovery phrase must be exactly 24 words.")
    case "This recovery phrase is not valid. Please check for typos.":
      return String(localized: "This recovery phrase is not valid. Please check for typos.")
    default:
      guard message.hasPrefix(unknownWordPrefix), message.hasSuffix(unknownWordSuffix) else { return message }
      let word = String(message.dropFirst(unknownWordPrefix.count).dropLast(unknownWordSuffix.count))
      return String(localized: "“\(word)” is not a valid recovery phrase word.")
    }
  }
}
