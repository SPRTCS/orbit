import CryptoKit
import Foundation

struct Failure: Error, CustomStringConvertible {
  let description: String
}

let arguments = CommandLine.arguments
guard arguments.count == 7 else {
  FileHandle.standardError.write(
    "usage: app-store-profile.swift <key.p8> <key id> <issuer id> <bundle id> <profile name> <certificate serial>\n".data(using: .utf8)!)
  exit(2)
}
let keyPath = arguments[1]
let keyID = arguments[2]
let issuerID = arguments[3]
let bundleIdentifier = arguments[4]
let profileName = arguments[5]
let certificateSerial = arguments[6].uppercased().trimmingCharacters(in: CharacterSet(charactersIn: "0"))

func base64URL(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

func token() throws -> String {
  let key = try P256.Signing.PrivateKey(pemRepresentation: String(contentsOfFile: keyPath, encoding: .utf8))
  let now = Int(Date().timeIntervalSince1970)
  let header = try JSONSerialization.data(withJSONObject: ["alg": "ES256", "kid": keyID, "typ": "JWT"])
  let payload = try JSONSerialization.data(withJSONObject: [
    "iss": issuerID, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1",
  ])
  let signingInput = base64URL(header) + "." + base64URL(payload)
  let signature = try key.signature(for: Data(signingInput.utf8))
  return signingInput + "." + base64URL(signature.rawRepresentation)
}

let bearer = try token()

func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
  var request = URLRequest(url: URL(string: "https://api.appstoreconnect.apple.com" + path)!)
  request.httpMethod = method
  request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
  if let body {
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
  }
  let (data, response) = try await URLSession.shared.data(for: request)
  let status = (response as? HTTPURLResponse)?.statusCode ?? 0
  guard (200..<300).contains(status) else {
    throw Failure(description: "\(method) \(path) failed with \(status): \(String(decoding: data, as: UTF8.self))")
  }
  return data.isEmpty ? [:] : (try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:])
}

func items(_ response: [String: Any]) -> [[String: Any]] {
  response["data"] as? [[String: Any]] ?? []
}

func attributes(_ item: [String: Any]) -> [String: Any] {
  item["attributes"] as? [String: Any] ?? [:]
}

func query(_ value: String) -> String {
  var allowed = CharacterSet.alphanumerics
  allowed.insert(charactersIn: "-._~")
  return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

func install(_ profile: [String: Any]) throws {
  let attributes = attributes(profile)
  guard let content = attributes["profileContent"] as? String, let data = Data(base64Encoded: content),
    let uuid = attributes["uuid"] as? String
  else { throw Failure(description: "The profile has no content.") }
  let folder = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Developer/Xcode/UserData/Provisioning Profiles", isDirectory: true)
  try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  try data.write(to: folder.appendingPathComponent("\(uuid).mobileprovision"), options: .atomic)
  print("Installed provisioning profile \(profileName) (\(uuid))")
}

func registeredBundleID() async throws -> String {
  let bundles = items(try await request("GET", "/v1/bundleIds?filter[identifier]=\(query(bundleIdentifier))&limit=200"))
  if let bundle = bundles.first(where: { attributes($0)["identifier"] as? String == bundleIdentifier }),
    let id = bundle["id"] as? String
  {
    return id
  }
  let created = try await request(
    "POST", "/v1/bundleIds",
    body: [
      "data": [
        "type": "bundleIds",
        "attributes": ["identifier": bundleIdentifier, "name": "Orbit Mobile", "platform": "IOS"],
      ]
    ])
  guard let id = (created["data"] as? [String: Any])?["id"] as? String else {
    throw Failure(description: "Registering the App ID \(bundleIdentifier) returned nothing.")
  }
  print("Registered App ID \(bundleIdentifier)")
  return id
}

func run() async throws {
  let bundleID = try await registeredBundleID()

  let certificates = items(try await request("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200"))
  guard
    let certificate = certificates.first(where: {
      (attributes($0)["serialNumber"] as? String)?.uppercased().trimmingCharacters(in: CharacterSet(charactersIn: "0")) == certificateSerial
    }), let certificateID = certificate["id"] as? String
  else { throw Failure(description: "The local Apple Distribution certificate isn't on the developer account.") }

  var existing: [[String: Any]] = []
  var nextPage: String? = "/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=200"
  while let page = nextPage {
    let response = try await request("GET", page)
    existing += items(response)
    nextPage = ((response["links"] as? [String: Any])?["next"] as? String)?
      .replacingOccurrences(of: "https://api.appstoreconnect.apple.com", with: "")
  }
  for profile in existing where attributes(profile)["name"] as? String == profileName {
    let isActive = attributes(profile)["profileState"] as? String == "ACTIVE"
    let profileID = profile["id"] as? String ?? ""
    let linked = items(try await request("GET", "/v1/profiles/\(profileID)/certificates?limit=200")).compactMap { $0["id"] as? String }
    if isActive, linked.contains(certificateID) {
      try install(profile)
      return
    }
    _ = try await request("DELETE", "/v1/profiles/\(profileID)")
  }

  let created = try await request(
    "POST", "/v1/profiles",
    body: [
      "data": [
        "type": "profiles",
        "attributes": ["name": profileName, "profileType": "IOS_APP_STORE"],
        "relationships": [
          "bundleId": ["data": ["type": "bundleIds", "id": bundleID]],
          "certificates": ["data": [["type": "certificates", "id": certificateID]]],
        ],
      ]
    ])
  guard let profile = created["data"] as? [String: Any] else { throw Failure(description: "Creating the profile returned nothing.") }
  try install(profile)
}

do {
  try await run()
} catch {
  FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
  exit(1)
}
