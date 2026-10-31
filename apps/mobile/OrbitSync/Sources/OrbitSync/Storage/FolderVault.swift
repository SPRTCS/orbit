import Foundation

struct FolderVault {
  static let fileExtension = "nns"

  let folder: URL
  let keys: SyncKeys
  private var fileManager: FileManager { .default }

  var chainURL: URL { folder.appendingPathComponent(keys.chainTag, isDirectory: true) }

  func scopeURL(_ scope: String) -> URL { chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true) }

  var folderExists: Bool { isDirectory(folder) }

  func chainExists() -> Bool {
    if isDirectory(chainURL) { return true }
    refreshListing(of: folder)
    return isDirectory(chainURL)
  }

  func read(scope: String, skipping known: Set<String>) -> FolderListing {
    var listing = FolderListing()
    let directory = scopeURL(scope)
    refreshListing(of: directory)
    guard let names = try? fileManager.contentsOfDirectory(atPath: directory.path) else { return listing }
    let suffix = ".\(Self.fileExtension)"
    let placeholderSuffix = "\(suffix).icloud"
    let scopeTag = keys.scopeTag(scope)
    var present = Set<String>()
    func notePresent(_ id: String) {
      if present.insert(id).inserted { listing.present.append(id) }
    }
    for name in names.sorted() {
      if name.hasPrefix("."), name.hasSuffix(placeholderSuffix) {
        let id = String(name.dropFirst().dropLast(placeholderSuffix.count))
        guard Base32.isTag(id), !present.contains(id) else { continue }
        notePresent(id)
        if !known.contains(id) {
          listing.pending.append(id)
          try? fileManager.startDownloadingUbiquitousItem(at: directory.appendingPathComponent("\(id)\(suffix)"))
        }
        continue
      }
      guard name.hasSuffix(suffix) else { continue }
      let id = String(name.dropLast(suffix.count))
      guard Base32.isTag(id) else { continue }
      notePresent(id)
      if known.contains(id) { continue }
      let url = directory.appendingPathComponent(name)
      let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .contentModificationDateKey])
      if values?.isUbiquitousItem == true, let status = values?.ubiquitousItemDownloadingStatus, status != .current {
        if !listing.pending.contains(id) { listing.pending.append(id) }
        try? fileManager.startDownloadingUbiquitousItem(at: url)
        continue
      }
      listing.pending.removeAll { $0 == id }
      do {
        let data = try coordinatedRead(url)
        listing.files.append(ListedFile(id: id, payload: try keys.open(data, scopeTag: scopeTag, fileId: id)))
      } catch {
        listing.damaged.append(id)
      }
    }
    return listing
  }

  func write(scope: String, payload: Data) throws -> String {
    let id = SyncKeys.newFileId()
    let sealed = try keys.seal(payload, scopeTag: keys.scopeTag(scope), fileId: id)
    let directory = scopeURL(scope)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent("\(id).\(Self.fileExtension)")
    let staging = stagingDirectory(near: directory)
    defer { try? fileManager.removeItem(at: staging) }
    let temporary = staging.appendingPathComponent(id)
    try sealed.write(to: temporary)
    try coordinatedWrite(destination) { url in
      try fileManager.moveItem(at: temporary, to: url)
    }
    return id
  }

  private func stagingDirectory(near directory: URL) -> URL {
    if let url = try? fileManager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: directory, create: true) {
      return url
    }
    let url = fileManager.temporaryDirectory.appendingPathComponent("OrbitSync-\(UUID().uuidString)", isDirectory: true)
    try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func isDirectory(_ url: URL) -> Bool {
    var isDirectory: ObjCBool = false
    return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  private func refreshListing(of directory: URL) {
    try? fileManager.startDownloadingUbiquitousItem(at: directory)
    var error: NSError?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: directory, options: [.immediatelyAvailableMetadataOnly], error: &error) { _ in }
  }

  private func coordinatedRead(_ url: URL) throws -> Data {
    var coordinationError: NSError?
    var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordinationError) { url in
      result = Result { try Data(contentsOf: url) }
    }
    if let coordinationError { throw coordinationError }
    return try result.get()
  }

  private func coordinatedWrite(_ url: URL, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { url in
      do { try body(url) } catch { bodyError = error }
    }
    if let error = coordinationError ?? bodyError { throw error }
  }
}
