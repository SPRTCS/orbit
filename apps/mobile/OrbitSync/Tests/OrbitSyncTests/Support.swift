#if os(macOS)
import ArdiaSyncCore
import Foundation
import XCTest
@testable import OrbitSync

enum Paths {
  static let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  static let repo = package.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  static let interop = package.appendingPathComponent("Tests/OrbitSyncTests/Interop")
  static let testLoader = repo.appendingPathComponent("apps/browser/src/test-loader.mjs")

  static func scratch(_ name: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("OrbitSyncTests-\(name)-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url.resolvingSymlinksInPath()
  }
}

enum Node {
  static let executable: String? = {
    if let configured = ProcessInfo.processInfo.environment["ORBIT_NODE"] { return configured }
    let path = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    for directory in path + ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] {
      let candidate = "\(directory)/node"
      if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
    }
    let shell = Process()
    shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
    shell.arguments = ["-lc", "command -v node"]
    let pipe = Pipe()
    shell.standardOutput = pipe
    try? shell.run()
    shell.waitUntilExit()
    let found = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return found.isEmpty ? nil : found
  }()

  static func run(_ arguments: [String]) throws {
    guard let executable else { throw XCTSkip("node isn't installed") }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = ["--no-warnings"] + arguments
    process.currentDirectoryURL = Paths.interop
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw NSError(domain: "node", code: Int(process.terminationStatus)) }
  }
}

final class LineReader: @unchecked Sendable {
  private let condition = NSCondition()
  private var buffer = Data()
  private var closed = false

  init(_ handle: FileHandle) {
    handle.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard let self else { return }
      self.condition.lock()
      if data.isEmpty { self.closed = true } else { self.buffer.append(data) }
      self.condition.broadcast()
      self.condition.unlock()
    }
  }

  func next(timeout: TimeInterval) throws -> String {
    let deadline = Date().addingTimeInterval(timeout)
    condition.lock()
    defer { condition.unlock() }
    while true {
      if let newline = buffer.firstIndex(of: 0x0A) {
        let line = buffer[buffer.startIndex..<newline]
        buffer.removeSubrange(buffer.startIndex...newline)
        return String(decoding: line, as: UTF8.self)
      }
      if closed { throw NSError(domain: "node", code: 1, userInfo: [NSLocalizedDescriptionKey: "the Mac process exited"]) }
      if !condition.wait(until: deadline) { throw NSError(domain: "node", code: 2, userInfo: [NSLocalizedDescriptionKey: "the Mac process timed out"]) }
    }
  }
}

final class MacDevice {
  let entropy: Data
  private let process = Process()
  private let input = Pipe()
  private let output = Pipe()
  private let reader: LineReader
  private var keys: ArdiaSyncCore.SyncKeys?
  private var commandCount = 0

  init(entropy: Data) throws {
    guard let executable = Node.executable else { throw XCTSkip("node isn't installed") }
    self.entropy = entropy
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = ["--no-warnings", "--import", Paths.testLoader.path, Paths.interop.appendingPathComponent("mac-device.mjs").path]
    process.currentDirectoryURL = Paths.repo.appendingPathComponent("apps/browser")
    process.standardInput = input
    process.standardOutput = output
    reader = LineReader(output.fileHandleForReading)
    try process.run()
    let ready = try JSONValue.parse(Data(try reader.next(timeout: 120).utf8))
    guard ready["type"]?.string == "ready" else { throw NSError(domain: "node", code: 3) }
  }

  deinit {
    try? input.fileHandleForWriting.write(contentsOf: Data("{\"type\":\"quit\"}\n".utf8))
    process.waitUntilExit()
  }

  @discardableResult
  func command(_ name: String, _ args: [String: Any] = [:]) throws -> JSONValue {
    commandCount += 1
    let id = commandCount
    try send(["type": "cmd", "id": id, "name": name, "args": args])
    while true {
      let message = try JSONValue.parse(Data(try reader.next(timeout: 300).utf8))
      switch message["type"]?.string {
      case "rpc":
        let callId = message["id"]?.number ?? 0
        let method = message["method"]?.string ?? ""
        do {
          let result = try handle(method, message["args"]?.array ?? [])
          try send(["type": "rpcResult", "id": callId, "result": result])
        } catch {
          try send(["type": "rpcResult", "id": callId, "error": "\(error)"])
        }
      case "done":
        if let error = message["error"]?.string { throw NSError(domain: "mac", code: 4, userInfo: [NSLocalizedDescriptionKey: "\(name): \(error)"]) }
        return message["result"] ?? .null
      default:
        continue
      }
    }
  }

  private func send(_ message: [String: Any]) throws {
    var data = try JSONSerialization.data(withJSONObject: message)
    data.append(0x0A)
    try input.fileHandleForWriting.write(contentsOf: data)
  }

  private func vault(_ path: String, keys: ArdiaSyncCore.SyncKeys? = nil) throws -> SyncVault {
    guard let keys = keys ?? self.keys else { throw NSError(domain: "mac", code: 5, userInfo: [NSLocalizedDescriptionKey: "locked"]) }
    return SyncVault(folder: URL(fileURLWithPath: path, isDirectory: true), keys: keys)
  }

  private func handle(_ method: String, _ args: [JSONValue]) throws -> Any {
    let string = { (index: Int) in args.indices.contains(index) ? args[index].string ?? "" : "" }
    switch method {
    case "createPhrase":
      keys = ArdiaSyncCore.SyncKeys(entropy: entropy)
      return true
    case "enterPhrase":
      let entropy: Data
      do {
        entropy = try ArdiaSyncCore.RecoveryPhrase.entropy(from: string(1))
      } catch ArdiaSyncCore.RecoveryPhrase.Problem.wordCount(let count) {
        return ["error": "wordCount", "count": count]
      } catch ArdiaSyncCore.RecoveryPhrase.Problem.unknownWord(let word) {
        return ["error": "unknownWord", "word": word]
      } catch {
        return ["error": "checksum"]
      }
      let candidate = ArdiaSyncCore.SyncKeys(entropy: entropy)
      guard try vault(string(2), keys: candidate).chainExists() else { return ["error": "mismatch"] }
      keys = candidate
      return ["ok": true]
    case "chainStatus":
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: string(0), isDirectory: &isDirectory), isDirectory.boolValue else { return "unavailable" }
      return try vault(string(0)).chainExists() ? "ok" : "missing"
    case "createChain":
      try FileManager.default.createDirectory(atPath: string(0), withIntermediateDirectories: true)
      try vault(string(0)).createChain()
      return NSNull()
    case "write":
      return try vault(string(0)).write(scope: string(1), payload: Data(string(2).utf8))
    case "read":
      let known = Set(args.indices.contains(2) ? args[2].array?.compactMap(\.string) ?? [] : [])
      let listing = try vault(string(0)).read(scope: string(1), skipping: known)
      return [
        "files": listing.files.map { ["id": $0.id, "payload": String(decoding: $0.payload, as: UTF8.self)] },
        "pending": listing.pending,
        "damaged": listing.damaged.map { ["id": $0.id, "age": $0.age * 1000] },
        "present": listing.present,
      ] as [String: Any]
    case "remove":
      try vault(string(0)).remove(scope: string(1), ids: args.indices.contains(2) ? args[2].array?.compactMap(\.string) ?? [] : [])
      return NSNull()
    case "deleteChain":
      try vault(string(0)).deleteChain()
      return NSNull()
    default:
      throw NSError(domain: "mac", code: 6, userInfo: [NSLocalizedDescriptionKey: "unknown native call \(method)"])
    }
  }
}

final class MemoryKeyStore: OrbitSync.SyncKeyStore, @unchecked Sendable {
  private let lock = NSLock()
  private var stored: [String: Data] = [:]
  private var refusedSaves: Set<String>?
  private var refusesDeletes = false
  var items: [String: Data] {
    get { lock.withLock { stored } }
    set { lock.withLock { stored = newValue } }
  }
  func refuseSaves(except allowed: Set<String>?) { lock.withLock { refusedSaves = allowed } }
  func refuseDeletes(_ refuse: Bool) { lock.withLock { refusesDeletes = refuse } }
  func load(account: String) -> Data? { lock.withLock { stored[account] } }
  func save(_ secret: Data, account: String) -> Bool {
    lock.withLock {
      if let allowed = refusedSaves, !allowed.contains(account) { return false }
      stored[account] = secret
      return true
    }
  }
  func delete(account: String) { lock.withLock { if !refusesDeletes { stored[account] = nil } } }
}

extension JSONValue {
  static func from(_ any: Any) -> JSONValue { JSONValue(any: any) }
}
#endif
