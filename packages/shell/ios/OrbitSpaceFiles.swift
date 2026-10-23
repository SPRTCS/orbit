import AppKit
import ExpoModulesCore
import Foundation
import UniformTypeIdentifiers

enum OrbitSpaceFiles {
  static let fileExtension = "orbitspace"
  static let maxBytes = 16 * 1024 * 1024
  static let work = DispatchQueue(label: "orbit.spacefiles", qos: .utility)

  static var contentTypes: [UTType] {
    [UTType(filenameExtension: fileExtension), .json].compactMap { $0 }
  }

  static func fileURL(_ string: String) -> URL? {
    if let url = URL(string: string), url.isFileURL { return url }
    return string.hasPrefix("/") ? URL(fileURLWithPath: string) : nil
  }

  static func modified(_ url: URL) -> Double? {
    guard let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate else { return nil }
    return date.timeIntervalSince1970 * 1000
  }

  static func read(_ url: URL) throws -> [String: Any] {
    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
    if size > maxBytes { throw CocoaError(.fileReadTooLarge) }
    let data = try Data(contentsOf: url)
    guard let contents = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
    return ["contents": contents, "modified": modified(url) ?? 0, "path": url.path, "url": url.absoluteString]
  }
}

public class OrbitSpaceFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbitSpaceFiles")

    AsyncFunction("saveFile") { (name: String, contents: String, promise: Promise) in
      let panel = NSSavePanel()
      panel.nameFieldStringValue = name
      panel.canCreateDirectories = true
      panel.isExtensionHidden = false
      if let type = UTType(filenameExtension: OrbitSpaceFiles.fileExtension) { panel.allowedContentTypes = [type] }
      panel.begin { response in
        guard response == .OK, let url = panel.url else { return promise.resolve(nil) }
        OrbitSpaceFiles.work.async {
          do {
            try Data(contents.utf8).write(to: url, options: .atomic)
            promise.resolve(url.absoluteString)
          } catch {
            promise.reject("ERR_SPACE_SAVE", error.localizedDescription)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("pickFile") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = false
      panel.canChooseDirectories = false
      panel.allowedContentTypes = OrbitSpaceFiles.contentTypes
      panel.begin { response in
        promise.resolve(response == .OK ? panel.url?.absoluteString : nil)
      }
    }.runOnQueue(.main)

    AsyncFunction("readFile") { (location: String) throws -> [String: Any] in
      guard let url = OrbitSpaceFiles.fileURL(location) else { throw CocoaError(.fileReadInvalidFileName) }
      return try OrbitSpaceFiles.read(url)
    }.runOnQueue(OrbitSpaceFiles.work)

    AsyncFunction("modified") { (location: String) -> Double? in
      guard let url = OrbitSpaceFiles.fileURL(location) else { return nil }
      return OrbitSpaceFiles.modified(url)
    }.runOnQueue(OrbitSpaceFiles.work)
  }
}
