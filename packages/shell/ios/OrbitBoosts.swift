import AppKit
import ExpoModulesCore
import Foundation
import UniformTypeIdentifiers

public class OrbitBoostsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbitBoosts")

    AsyncFunction("publish") { (folder: String, files: [String: String]) throws -> [String: Any] in
      try OrbitBoosts.publish(folder, files)
    }.runOnQueue(OrbitBoosts.work)

    AsyncFunction("remove") { (folder: String) throws in try OrbitBoosts.remove(folder) }.runOnQueue(OrbitBoosts.work)

    AsyncFunction("folders") { () -> [String] in OrbitBoosts.folders() }.runOnQueue(OrbitBoosts.work)

    AsyncFunction("exportFile") { (name: String, contents: String, promise: Promise) in
      let panel = NSSavePanel()
      panel.nameFieldStringValue = name
      panel.canCreateDirectories = true
      if let type = UTType(filenameExtension: OrbitBoosts.fileExtension) { panel.allowedContentTypes = [type] }
      panel.begin { response in
        guard response == .OK, let url = panel.url else { return promise.resolve(false) }
        do {
          try Data(contents.utf8).write(to: url, options: .atomic)
          promise.resolve(true)
        } catch {
          promise.reject("ERR_BOOST_EXPORT", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("importFile") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = false
      panel.canChooseDirectories = false
      panel.allowedContentTypes = [OrbitBoosts.fileExtension, "json"].compactMap { UTType(filenameExtension: $0) }
      panel.begin { response in
        guard response == .OK, let url = panel.url else { return promise.resolve(nil) }
        OrbitBoosts.work.async {
          do {
            promise.resolve(try OrbitBoosts.readImport(url))
          } catch let refused as OrbitBoosts.Refused {
            promise.reject("ERR_BOOST_IMPORT", refused.message)
          } catch {
            promise.reject("ERR_BOOST_IMPORT", error.localizedDescription)
          }
        }
      }
    }.runOnQueue(.main)

    Function("pasteboardText") { () -> String? in NSPasteboard.general.string(forType: .string) }
  }
}

enum OrbitBoosts {
  static let work = DispatchQueue(label: "orbit.boosts", qos: .utility)
  static let fileExtension = "orbitboost"

  private static let importLimit = 1 << 20
  private static let folderPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,80}$")
  private static let partPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_][A-Za-z0-9._-]{0,120}$")

  struct Refused: Error {
    let message: String
    init(_ message: String) { self.message = message }
  }

  private static func matches(_ pattern: NSRegularExpression, _ text: String) -> Bool {
    pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
  }

  private static func root() throws -> URL {
    let dir = try ShellModule.documentURL("Boosts")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var st = stat()
    guard lstat(dir.path, &st) == 0, st.st_mode & S_IFMT == S_IFDIR else { throw Refused("Boosts isn't a plain folder") }
    return dir
  }

  private static func folderURL(_ folder: String) throws -> URL {
    guard matches(folderPattern, folder) else { throw Refused("\"\(folder)\" isn't a boosts folder name") }
    return try root().appendingPathComponent(folder, isDirectory: true)
  }

  private static func realPath(_ url: URL) -> String {
    guard let resolved = realpath(url.path, nil) else { return url.path }
    defer { free(resolved) }
    return String(cString: resolved)
  }

  private static func checked(_ relative: String) throws -> [String] {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard !parts.isEmpty, parts.count <= 4, parts.allSatisfy({ matches(partPattern, $0) }) else {
      throw Refused("\"\(relative)\" isn't a plain relative path")
    }
    return parts
  }

  private static func existing(_ ext: URL) -> [String: String]? {
    guard let walker = FileManager.default.enumerator(at: ext, includingPropertiesForKeys: [.isRegularFileKey], options: []) else { return nil }
    var found: [String: String] = [:]
    let base = ext.standardizedFileURL.path + "/"
    for case let url as URL in walker {
      guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
      let path = url.standardizedFileURL.path
      guard path.hasPrefix(base), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
      found[String(path.dropFirst(base.count))] = text
    }
    return found
  }

  static func publish(_ folder: String, _ files: [String: String]) throws -> [String: Any] {
    let dir = try folderURL(folder)
    for name in files.keys { _ = try checked(name) }
    guard files["manifest.json"] != nil else { throw Refused("manifest.json is missing") }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let ext = dir.appendingPathComponent("extension", isDirectory: true)
    var st = stat()
    let present = lstat(ext.path, &st) == 0
    if present && st.st_mode & S_IFMT != S_IFDIR { throw Refused("Boosts/\(folder)/extension isn't a plain folder") }
    if present, existing(ext) == files { return ["path": realPath(ext), "changed": false] }

    let staging = dir.appendingPathComponent(".extension-\(UUID().uuidString)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
      for (name, contents) in files {
        let target = staging.appendingPathComponent(try checked(name).joined(separator: "/"))
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(contents.utf8).write(to: target)
      }
      if present {
        guard renamex_np(staging.path, ext.path, UInt32(RENAME_SWAP)) == 0 else { throw Refused(String(cString: strerror(errno))) }
      } else {
        guard rename(staging.path, ext.path) == 0 else { throw Refused(String(cString: strerror(errno))) }
      }
    } catch {
      try? FileManager.default.removeItem(at: staging)
      throw error
    }
    try? FileManager.default.removeItem(at: staging)
    return ["path": realPath(ext), "changed": true]
  }

  static func remove(_ folder: String) throws {
    let dir = try folderURL(folder)
    var st = stat()
    guard lstat(dir.path, &st) == 0 else { return }
    try FileManager.default.removeItem(at: dir)
  }

  static func folders() -> [String] {
    guard let dir = try? root(), let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    return names.filter { matches(folderPattern, $0) }.sorted()
  }

  static func readImport(_ url: URL) throws -> String {
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values.isRegularFile == true else { throw Refused("That isn't a file.") }
    guard (values.fileSize ?? 0) <= importLimit else { throw Refused("That file is too large to be a boost.") }
    guard let text = String(data: try Data(contentsOf: url), encoding: .utf8) else { throw Refused("That file isn't text.") }
    return text
  }
}
