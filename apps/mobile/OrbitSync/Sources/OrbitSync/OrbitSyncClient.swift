import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif

final class SessionRunner: @unchecked Sendable {
  private let queue = DispatchQueue(label: "OrbitSync.session", qos: .utility)
  private let session: SyncSession

  init(_ session: SyncSession) { self.session = session }

  func run<T: Sendable>(_ body: @escaping @Sendable (SyncSession) throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { continuation.resume(with: Result { try body(self.session) }) }
    }
  }

  func runNow<T>(_ body: (SyncSession) throws -> T) rethrows -> T {
    try queue.sync { try body(session) }
  }
}

@MainActor
@Observable
public final class OrbitSyncClient: OrbitSyncing {
  public static let keychainService = "Orbit Sync Key"
  public static let outOfSyncMessage = "This device is out of sync. Sync may have been reset from another device."
  public static let folderUnavailableMessage = "The sync folder isn’t available. Check iCloud Drive, or choose the folder again."

  public private(set) var state: OrbitSyncState = .notSetUp
  public private(set) var devices: [SyncedDevice] = []
  public private(set) var spaces: [SyncedSpace] = []
  public private(set) var pendingDownloads = 0
  public private(set) var pendingRetirement = false
  public var thisDeviceName: String {
    didSet {
      let name = thisDeviceName
      runner.runNowAsync { $0.deviceName = name }
    }
  }

  @ObservationIgnored private let storage: LocalStorage
  @ObservationIgnored private let keyStore: any SyncKeyStore
  @ObservationIgnored let runner: SessionRunner
  @ObservationIgnored private(set) var deviceId: String
  @ObservationIgnored private var tail: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var connected: Bool
  @ObservationIgnored private let now: @Sendable () -> Date
  static let identityAccount = "identity"

  static func identitySaver(storage: LocalStorage, keyStore: any SyncKeyStore) -> (WriterRecord) throws -> Void {
    { record in
      guard keyStore.save(record.json.data, account: identityAccount) else { throw CocoaError(.fileWriteUnknown) }
      try storage.saveWriter(record)
    }
  }

  static func resolveIdentity(storage: LocalStorage, keyStore: any SyncKeyStore, now: Date) -> WriterRecord {
    let saved = storage.loadWriter()
    let anchor = WriterRecord(data: keyStore.load(account: identityAccount))
    let retiring = Set(storage.retirements.map(\.device))
    if let saved, let anchor, saved.device == anchor.device, !retiring.contains(saved.device) {
      let merged = saved.merged(with: anchor)
      if merged != saved || merged != anchor { try? identitySaver(storage: storage, keyStore: keyStore)(merged) }
      return merged
    }
    let disconnected = saved.map { retiring.contains($0.device) } ?? false
    let bookmark = storage.read(.bookmark)
    var displaced: [(device: String, bookmark: Data?)] = []
    if let saved, !retiring.contains(saved.device) { displaced.append((saved.device, bookmark)) }
    if let anchor, anchor.device != saved?.device, !retiring.contains(anchor.device) { displaced.append((anchor.device, nil)) }
    let createdAt = (now.timeIntervalSince1970 * 1000).rounded(.down)
    for old in displaced { try? storage.saveRetirement(RetirementRecord(device: old.device, bookmark: old.bookmark, created: createdAt)) }
    let carried = displaced.lazy.compactMap { keyStore.load(account: $0.device) }.first { $0.count == 32 }
    let fresh = WriterRecord(device: SyncKeys.newFileId())
    try? identitySaver(storage: storage, keyStore: keyStore)(fresh)
    storage.remove(.state)
    storage.remove(.journal)
    if disconnected {
      storage.remove(.bookmark)
    } else if let carried {
      _ = keyStore.save(carried, account: fresh.device)
    }
    return fresh
  }

  public convenience init() {
    self.init(storageDirectory: LocalStorage.defaultDirectory, keyStore: KeychainKeyStore(service: Self.keychainService), deviceName: Self.currentDeviceName, deviceKind: Self.currentDeviceKind)
  }

  init(storageDirectory: URL, keyStore: any SyncKeyStore, deviceName: String, deviceKind: String = OrbitSyncClient.currentDeviceKind, now: @escaping @Sendable () -> Date = { Date() }) {
    let storage = LocalStorage(directory: storageDirectory)
    storage.excludeFromBackup()
    let identity = Self.resolveIdentity(storage: storage, keyStore: keyStore, now: now())
    let bookmark = storage.read(.bookmark)
    self.storage = storage
    self.keyStore = keyStore
    self.deviceId = identity.device
    self.thisDeviceName = deviceName
    self.now = now
    connected = bookmark != nil
    let session = SyncSession(storage: storage, deviceId: identity.device, deviceName: deviceName, deviceKind: deviceKind, bookmark: bookmark, writer: identity, now: now)
    session.saveIdentity = Self.identitySaver(storage: storage, keyStore: keyStore)
    runner = SessionRunner(session)
    pendingRetirement = !storage.retirements.isEmpty
    if pendingRetirement { enqueue { await self.processRetirements() } }
    guard connected else { return }
    guard let entropy = savedEntropy else {
      state = .needsPhrase
      return
    }
    let (views, lastSync) = runner.runNow { session in
      session.unlock(entropy: entropy)
      return (session.views, session.lastSync)
    }
    show(views)
    state = .idle(lastSync: lastSync)
  }

  public static var currentDeviceName: String {
    #if canImport(UIKit)
    let name = UIDevice.current.name
    return name.isEmpty ? UIDevice.current.model : name
    #else
    return Host.current().localizedName ?? "Mac"
    #endif
  }

  public static var currentDeviceKind: String {
    #if canImport(UIKit)
    return UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
    #else
    return "mac"
    #endif
  }

  private var savedEntropy: Data? {
    guard let entropy = keyStore.load(account: deviceId), entropy.count == 32 else { return nil }
    return entropy
  }

  private enum ConnectOutcome: Sendable {
    case unlocked
    case needsPhrase
    case keyDoesNotMatch
  }

  public func connect(folder: URL) throws {
    let scoped = folder.startAccessingSecurityScopedResource()
    defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw OrbitSyncError.folderUnreadable("That folder can’t be opened.")
    }
    let bookmark: Data
    do {
      bookmark = try FolderBookmark.create(for: folder)
    } catch {
      throw OrbitSyncError.folderUnreadable(error.localizedDescription)
    }
    generation += 1
    let generation = self.generation
    connected = true
    state = savedEntropy == nil ? .needsPhrase : .syncing
    enqueue {
      guard self.isCurrent(generation) else { return }
      let deviceId = self.deviceId
      let entropy = self.savedEntropy
      let outcome: ConnectOutcome
      do {
        outcome = try await self.runner.run { session -> ConnectOutcome in
          try session.connect(bookmark: bookmark)
          guard let entropy else { return .needsPhrase }
          if (try? session.chainMatches(entropy: entropy)) == false {
            session.lock()
            return .keyDoesNotMatch
          }
          session.unlock(entropy: entropy)
          return .unlocked
        }
      } catch {
        if self.isCurrent(generation) { self.state = .failed(error.localizedDescription) }
        return
      }
      guard self.isCurrent(generation) else { return }
      switch outcome {
      case .unlocked:
        await self.runCycle(generation)
      case .keyDoesNotMatch, .needsPhrase:
        if outcome == .keyDoesNotMatch { self.keyStore.delete(account: deviceId) }
        self.show(SyncedViews())
        self.state = .needsPhrase
      }
    }
  }

  public func enterRecoveryPhrase(_ phrase: String) async throws {
    guard connected else { throw OrbitSyncError.notConnected }
    let entropy: Data
    do {
      entropy = try RecoveryPhrase.entropy(from: phrase)
    } catch let problem as RecoveryPhrase.Problem {
      throw OrbitSyncError.invalidPhrase(Self.message(for: problem))
    }
    let generation = self.generation
    try await serialized {
      guard self.isCurrent(generation) else { throw OrbitSyncError.notConnected }
      let deviceId = self.deviceId
      let matches: Bool
      do {
        matches = try await self.runner.run { try $0.adopt(entropy: entropy) }
      } catch SessionFailure.noFolder {
        throw OrbitSyncError.notConnected
      } catch {
        throw OrbitSyncError.folderUnreadable(Self.folderUnavailableMessage)
      }
      guard self.isCurrent(generation) else { throw OrbitSyncError.notConnected }
      guard matches else { throw OrbitSyncError.phraseDoesNotMatchFolder }
      guard self.keyStore.save(entropy, account: deviceId) else {
        throw OrbitSyncError.folderUnreadable("Couldn’t save the sync key in the Keychain.")
      }
      await self.runCycle(generation)
    }
  }

  public func syncNow() async {
    guard canSync else { return }
    let generation = self.generation
    try? await serialized { await self.runCycle(generation) }
  }

  public func publish(openTabs: [SyncedTab]) async {
    let tabs = openTabs
    let generation = self.generation
    try? await serialized {
      _ = try? await self.runner.run { $0.openTabs = tabs }
      if self.canSync { await self.runCycle(generation) }
    }
  }

  public func disconnect() {
    generation += 1
    let generation = self.generation
    let leaving = RetirementRecord(device: deviceId, bookmark: storage.read(.bookmark), created: (now().timeIntervalSince1970 * 1000).rounded(.down))
    try? storage.saveRetirement(leaving)
    connected = false
    pendingRetirement = true
    show(SyncedViews())
    state = .notSetUp
    enqueue {
      _ = try? await self.runner.run { $0.disconnect() }
      if !self.storage.retirements.contains(where: { $0.device == leaving.device }), (try? self.storage.saveRetirement(leaving)) == nil {
        self.keyStore.delete(account: leaving.device)
      }
      let fresh = WriterRecord(device: SyncKeys.newFileId())
      try? Self.identitySaver(storage: self.storage, keyStore: self.keyStore)(fresh)
      self.deviceId = fresh.device
      _ = try? await self.runner.run { $0.adoptIdentity(fresh) }
      await self.processRetirements()
      if self.isCurrent(generation) {
        self.show(SyncedViews())
        self.state = .notSetUp
      }
    }
  }

  func waitForPendingWork() async {
    await tail?.value
  }

  private func isCurrent(_ generation: Int) -> Bool { generation == self.generation }

  private var canSync: Bool {
    switch state {
    case .notSetUp, .needsPhrase: false
    case .syncing, .idle, .failed: true
    }
  }

  private func runCycle(_ generation: Int) async {
    guard isCurrent(generation) else { return }
    switch state {
    case .idle, .failed: state = .syncing
    default: break
    }
    let result = await Result { try await runner.run { session in (try session.cycle(), session.lastSync) } }
    guard isCurrent(generation) else { return }
    switch result {
    case .success(let (views, lastSync)):
      show(views)
      state = .idle(lastSync: lastSync)
      if pendingRetirement { await processRetirements() }
    case .failure(SessionFailure.locked):
      state = .needsPhrase
    case .failure(SessionFailure.noFolder):
      state = .notSetUp
    case .failure(SessionFailure.folderUnavailable):
      state = .failed(Self.folderUnavailableMessage)
    case .failure(SessionFailure.chainMissing):
      state = .failed(Self.outOfSyncMessage)
    case .failure(let error):
      state = .failed(error.localizedDescription)
    }
  }

  private func processRetirements() async {
    for record in storage.retirements where record.device != deviceId {
      guard let entropy = keyStore.load(account: record.device), entropy.count == 32 else {
        storage.removeRetirement(record.device)
        continue
      }
      guard let bookmark = record.bookmark ?? storage.read(.bookmark) else { continue }
      let storage = self.storage
      let now = self.now
      let done = (try? await runner.run { _ -> Bool in
        var working = record
        return try Retirement.process(&working, storage: storage, entropy: entropy, bookmark: bookmark, now: now())
      }) ?? false
      if done {
        storage.removeRetirement(record.device)
        keyStore.delete(account: record.device)
      }
    }
    pendingRetirement = !storage.retirements.isEmpty
  }

  private func show(_ views: SyncedViews) {
    if spaces != views.spaces { spaces = views.spaces }
    if devices != views.devices { devices = views.devices }
    if pendingDownloads != views.pending { pendingDownloads = views.pending }
  }

  @discardableResult
  private func enqueue(_ work: @escaping @MainActor () async throws -> Void) -> Task<Void, Error> {
    let previous = tail
    let task = Task { @MainActor in
      await previous?.value
      try await work()
    }
    tail = Task { _ = try? await task.value }
    return task
  }

  private func serialized(_ work: @escaping @MainActor () async throws -> Void) async throws {
    try await enqueue(work).value
  }

  static func message(for problem: RecoveryPhrase.Problem) -> String {
    switch problem {
    case .wordCount: "Recovery phrase must be exactly 24 words."
    case .unknownWord(let word): "“\(word)” is not a valid recovery phrase word."
    case .checksum: "This recovery phrase is not valid. Please check for typos."
    }
  }
}

extension SessionRunner {
  func runNowAsync(_ body: @escaping @Sendable (SyncSession) -> Void) {
    Task { _ = try? await run { body($0) } }
  }
}
