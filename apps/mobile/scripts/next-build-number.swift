import CryptoKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 6 else {
  FileHandle.standardError.write("usage: next-build-number.swift <key.p8> <key id> <issuer id> <bundle id> <version>\n".data(using: .utf8)!)
  exit(2)
}
let (keyPath, keyID, issuerID, bundleIdentifier, version) = (arguments[1], arguments[2], arguments[3], arguments[4], arguments[5])

func base64URL(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

func token() throws -> String {
  let key = try P256.Signing.PrivateKey(pemRepresentation: String(contentsOfFile: keyPath, encoding: .utf8))
  let now = Int(Date().timeIntervalSince1970)
  let header = try JSONSerialization.data(withJSONObject: ["alg": "ES256", "kid": keyID, "typ": "JWT"])
  let payload = try JSONSerialization.data(withJSONObject: ["iss": issuerID, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"])
  let signingInput = base64URL(header) + "." + base64URL(payload)
  return signingInput + "." + base64URL(try key.signature(for: Data(signingInput.utf8)).rawRepresentation)
}

func get(_ path: String, bearer: String) async throws -> [[String: Any]] {
  var request = URLRequest(url: URL(string: "https://api.appstoreconnect.apple.com" + path)!)
  request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
  let (data, response) = try await URLSession.shared.data(for: request)
  guard (response as? HTTPURLResponse)?.statusCode == 200 else {
    throw NSError(domain: "AppStoreConnect", code: 1, userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)])
  }
  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
  return object?["data"] as? [[String: Any]] ?? []
}

func encoded(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_~"))) ?? value }

let bearer = try token()
guard let app = try await get("/v1/apps?filter[bundleId]=\(encoded(bundleIdentifier))", bearer: bearer).first, let appID = app["id"] as? String else {
  FileHandle.standardError.write("No App Store Connect app for \(bundleIdentifier)\n".data(using: .utf8)!)
  exit(1)
}
let builds = try await get("/v1/builds?filter[app]=\(appID)&filter[preReleaseVersion.version]=\(encoded(version))&fields[builds]=version&limit=200", bearer: bearer)
let numbers = builds.compactMap { (($0["attributes"] as? [String: Any])?["version"] as? String).flatMap { Int($0) } }
print((numbers.max() ?? 0) + 1)
