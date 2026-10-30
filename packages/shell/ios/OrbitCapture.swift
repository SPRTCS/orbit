import AppKit
import ExpoModulesCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum OrbitCapture {
  static let work = DispatchQueue(label: "orbit.capture", qos: .userInitiated)
  static let keepFor: TimeInterval = 24 * 60 * 60
  static let tiffPixelLimit = 12_000_000

  static var folder: URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("Orbit Captures", isDirectory: true)
  }

  static func prepareFolder() -> String {
    let manager = FileManager.default
    let url = folder
    try? manager.createDirectory(at: url, withIntermediateDirectories: true)
    let cutoff = Date().addingTimeInterval(-keepFor)
    let files = (try? manager.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    for file in files {
      let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
      if modified < cutoff { try? manager.removeItem(at: file) }
    }
    return url.path
  }

  static func source(_ path: String) -> CGImageSource? {
    CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)
  }

  static func pixelSize(_ source: CGImageSource) -> (width: Int, height: Int)? {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    return (width, height)
  }

  static func pngData(_ image: CGImage) -> Data? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, nil)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
  }

  static func thumbnail(_ source: CGImageSource, size: (width: Int, height: Int), width: Int, maxAspect: Double) -> String? {
    guard size.width > 0, size.height > 0 else { return nil }
    let scale = min(1, Double(width) / Double(size.width))
    let longest = Int((Double(max(size.width, size.height)) * scale).rounded(.up))
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: max(1, longest),
      kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    guard var image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let tallest = Int((Double(image.width) * maxAspect).rounded())
    if image.height > tallest, let top = image.cropping(to: CGRect(x: 0, y: 0, width: image.width, height: tallest)) { image = top }
    guard let data = pngData(image) else { return nil }
    return "data:image/png;base64," + data.base64EncodedString()
  }

  static func info(_ path: String, thumbnailWidth: Int, maxAspect: Double) -> [String: Any]? {
    guard let source = source(path), let size = pixelSize(source) else { return nil }
    let attributes = try? FileManager.default.attributesOfItem(atPath: path)
    let bytes = (attributes?[.size] as? NSNumber)?.intValue ?? 0
    var result: [String: Any] = ["width": size.width, "height": size.height, "bytes": bytes]
    if let thumb = thumbnail(source, size: size, width: thumbnailWidth, maxAspect: maxAspect) { result["thumbnail"] = thumb }
    return result
  }

  static func copy(_ path: String) -> Bool {
    guard let png = try? Data(contentsOf: URL(fileURLWithPath: path)), let source = CGImageSourceCreateWithData(png as CFData, nil),
      let size = pixelSize(source)
    else { return false }
    let item = NSPasteboardItem()
    item.setData(png, forType: .png)
    if size.width * size.height <= tiffPixelLimit, let image = CGImageSourceCreateImageAtIndex(source, 0, nil) {
      let rep = NSBitmapImageRep(cgImage: image)
      if let tiff = rep.tiffRepresentation { item.setData(tiff, forType: .tiff) }
    }
    let board = NSPasteboard.general
    board.clearContents()
    return board.writeObjects([item])
  }

  static var downloads: String {
    (FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
      ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")).path
  }
}

public class OrbitCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbitCapture")

    AsyncFunction("prepareFolder") { () -> String in
      OrbitCapture.prepareFolder()
    }.runOnQueue(OrbitCapture.work)

    AsyncFunction("imageInfo") { (path: String, thumbnailWidth: Int, maxAspect: Double) -> [String: Any]? in
      OrbitCapture.info(path, thumbnailWidth: thumbnailWidth, maxAspect: maxAspect)
    }.runOnQueue(OrbitCapture.work)

    AsyncFunction("copyImage") { (path: String) -> Bool in
      OrbitCapture.copy(path)
    }.runOnQueue(.main)

    Function("downloadsFolder") { () -> String in
      OrbitCapture.downloads
    }

    AsyncFunction("saveCopy") { (from: String, to: String) -> Bool in
      let manager = FileManager.default
      guard !manager.fileExists(atPath: to) else { return false }
      do {
        try manager.createDirectory(at: URL(fileURLWithPath: to).deletingLastPathComponent(), withIntermediateDirectories: true)
        try manager.copyItem(atPath: from, toPath: to)
        return true
      } catch {
        return false
      }
    }.runOnQueue(OrbitCapture.work)

    AsyncFunction("removeFile") { (path: String) in
      guard path.hasPrefix(OrbitCapture.folder.path) else { return }
      try? FileManager.default.removeItem(atPath: path)
    }.runOnQueue(OrbitCapture.work)
  }
}
