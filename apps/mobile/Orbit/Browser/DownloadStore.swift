import SwiftUI
import WebKit

struct DownloadedFile: Identifiable, Equatable {
  let url: URL
  let size: Int64
  let date: Date

  var id: URL { url }
  var name: String { url.lastPathComponent }
}

@Observable
final class ActiveDownload: Identifiable {
  let id = UUID()
  var filename: String
  var fraction: Double = 0
  @ObservationIgnored let download: WKDownload
  @ObservationIgnored var destination: URL?
  @ObservationIgnored var observation: NSKeyValueObservation?

  init(download: WKDownload, filename: String) {
    self.download = download
    self.filename = filename
  }
}

enum DownloadPolicy {
  static func shouldDownload(canShowMIMEType: Bool, contentDisposition: String?, isMainFrame: Bool) -> Bool {
    if let contentDisposition, contentDisposition.lowercased().hasPrefix("attachment") { return true }
    return isMainFrame && !canShowMIMEType
  }

  static func sanitized(_ name: String) -> String {
    let cleaned = name.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let visible = cleaned.hasPrefix(".") ? String(cleaned.drop { $0 == "." }) : cleaned
    return visible.isEmpty ? "Download" : visible
  }

  static func uniqueURL(named name: String, in directory: URL, exists: (URL) -> Bool) -> URL {
    let safe = sanitized(name)
    let first = directory.appending(path: safe)
    guard exists(first) else { return first }
    let base = first.deletingPathExtension().lastPathComponent
    let ext = first.pathExtension
    for index in 2...10_000 {
      let candidate = directory.appending(path: ext.isEmpty ? "\(base) \(index)" : "\(base) \(index).\(ext)")
      if !exists(candidate) { return candidate }
    }
    return directory.appending(path: "\(UUID().uuidString)-\(safe)")
  }
}

@Observable
final class DownloadStore: NSObject, WKDownloadDelegate {
  static var standardDirectory: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appending(path: "Downloads", directoryHint: .isDirectory)
  }

  let directory: URL
  private(set) var files: [DownloadedFile] = []
  private(set) var active: [ActiveDownload] = []
  @ObservationIgnored var onFinish: ((DownloadedFile) -> Void)?
  @ObservationIgnored var onFail: ((String) -> Void)?

  init(directory: URL = DownloadStore.standardDirectory) {
    self.directory = directory
    super.init()
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    reload()
  }

  func reload() {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
    let found =
      (try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])) ?? []
    let inProgress = Set(active.compactMap(\.destination))
    files = found.compactMap { url -> DownloadedFile? in
      guard !inProgress.contains(url), let values = try? url.resourceValues(forKeys: Set(keys)),
        values.isRegularFile == true
      else { return nil }
      return DownloadedFile(
        url: url, size: Int64(values.fileSize ?? 0), date: values.contentModificationDate ?? .distantPast)
    }
    .sorted { $0.date > $1.date }
  }

  func track(_ download: WKDownload, source: URL?) {
    let item = ActiveDownload(download: download, filename: source?.lastPathComponent ?? "Download")
    item.observation = download.progress.observe(\.fractionCompleted) { [weak item] progress, _ in
      let fraction = progress.fractionCompleted
      Task { @MainActor in item?.fraction = fraction }
    }
    download.delegate = self
    active.append(item)
  }

  func cancel(_ item: ActiveDownload) {
    item.download.cancel { _ in }
    finish(item)
    if let destination = item.destination { try? FileManager.default.removeItem(at: destination) }
    reload()
  }

  func delete(_ file: DownloadedFile) {
    try? FileManager.default.removeItem(at: file.url)
    files.removeAll { $0.id == file.id }
  }

  func deleteAll() {
    for file in files { try? FileManager.default.removeItem(at: file.url) }
    files = []
  }

  private func item(for download: WKDownload) -> ActiveDownload? {
    active.first { $0.download === download }
  }

  private func finish(_ item: ActiveDownload) {
    item.observation = nil
    active.removeAll { $0.id == item.id }
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async
    -> URL?
  {
    let destination = DownloadPolicy.uniqueURL(named: suggestedFilename, in: directory) {
      FileManager.default.fileExists(atPath: $0.path(percentEncoded: false))
    }
    if let item = item(for: download) {
      item.filename = destination.lastPathComponent
      item.destination = destination
    }
    return destination
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let item = item(for: download) else { return }
    finish(item)
    reload()
    if let destination = item.destination, let file = files.first(where: { $0.url == destination }) {
      onFinish?(file)
    }
  }

  func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
    guard let item = item(for: download) else { return }
    finish(item)
    if let destination = item.destination { try? FileManager.default.removeItem(at: destination) }
    reload()
    if (error as NSError).code != NSURLErrorCancelled { onFail?(item.filename) }
  }
}
