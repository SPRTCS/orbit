import Foundation
import Security

struct UpdatingKeychainKeyStore: SyncKeyStore {
  let service: String

  private func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: false,
    ]
  }

  func load(account: String) -> Data? {
    var lookup = query(account)
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return data
  }

  func save(_ secret: Data, account: String) -> Bool {
    let attributes: [String: Any] = [
      kSecValueData as String: secret,
      kSecAttrLabel as String: service,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updated = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
    if updated == errSecSuccess { return true }
    guard updated == errSecItemNotFound else { return false }
    let add = query(account).merging(attributes) { $1 }
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  func delete(account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
