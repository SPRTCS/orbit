import ExpoModulesCore
import Foundation

enum OrbitFiles {
  static let work = DispatchQueue(label: "orbit.files", qos: .userInitiated)
  static let maxAttempts = 99

  static func isSafeName(_ name: String) -> Bool {
    !name.isEmpty && name != "." && name != ".." && !name.hasPrefix(".") && !name.contains("/") && !name.contains(":")
      && !name.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7F } && name.utf8.count <= 255
  }

  static func candidate(_ name: String, _ n: Int) -> String {
    if n == 1 { return name }
    let ext = (name as NSString).pathExtension
    let base = ext.isEmpty ? name : (name as NSString).deletingPathExtension
    return ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
  }

  static func identity(_ path: String) -> String? {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
      attributes[.type] as? FileAttributeType == .typeRegular,
      let device = (attributes[.systemNumber] as? NSNumber)?.uint64Value,
      let inode = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value
    else { return nil }
    return "\(device):\(inode)"
  }

  static func rename(_ path: String, to name: String, expecting expected: String?) -> String? {
    guard isSafeName(name) else { return nil }
    let manager = FileManager.default
    let source = URL(fileURLWithPath: path).standardizedFileURL
    guard let current = identity(source.path) else { return nil }
    if let expected, expected != current { return nil }
    if source.lastPathComponent == name { return source.path }
    let folder = source.deletingLastPathComponent()
    for n in 1...maxAttempts {
      let target = folder.appendingPathComponent(candidate(name, n))
      if target.path.caseInsensitiveCompare(source.path) == .orderedSame {
        do {
          try manager.moveItem(at: source, to: target)
          return target.path
        } catch {
          return nil
        }
      }
      if manager.fileExists(atPath: target.path) { continue }
      do {
        try manager.moveItem(at: source, to: target)
        return target.path
      } catch CocoaError.fileWriteFileExists {
        continue
      } catch {
        return nil
      }
    }
    return nil
  }
}

public class OrbitFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbitFiles")

    AsyncFunction("fileIdentity") { (path: String) -> String? in
      OrbitFiles.identity(URL(fileURLWithPath: path).standardizedFileURL.path)
    }.runOnQueue(OrbitFiles.work)

    AsyncFunction("renameFile") { (path: String, name: String, identity: String?) -> String? in
      OrbitFiles.rename(path, to: name, expecting: identity)
    }.runOnQueue(OrbitFiles.work)
  }
}
