import Foundation

struct Origin: Hashable, Sendable {
  var device: String
  var seq: Int
}

struct SyncRecord: Hashable, Sendable {
  var h: String
  var v: JSONValue
  var o: Origin
}

struct SyncOp: Hashable, Sendable {
  var k: String
  var h: String
  var v: JSONValue
}

struct FileMeta: Hashable, Sendable {
  enum Kind: String, Sendable {
    case log
    case snapshot
    case bad
  }

  var d: String
  var k: Kind
  var s: Int?
  var vv: [String: Int]?
  var at: Double
}

struct LogFile: Hashable, Sendable {
  var device: String
  var seq: Int
  var at: Double
  var ops: [SyncOp]

  var json: JSONValue {
    .object([
      "v": .number(1),
      "kind": .string("log"),
      "device": .string(device),
      "seq": .number(Double(seq)),
      "at": .number(at),
      "ops": .array(ops.map { .object(["k": .string($0.k), "h": .string($0.h), "v": $0.v]) }),
    ])
  }
}

struct ListedFile: Sendable {
  var id: String
  var payload: Data
}

struct FolderListing: Sendable {
  var files: [ListedFile] = []
  var pending: [String] = []
  var damaged: [String] = []
  var present: [String] = []
}

enum ParsedFile {
  case log(device: String, seq: Int, at: Double, ops: [(key: String, h: String, v: Any)])
  case snapshot(device: String, at: Double, vv: [String: Int], seen: [String: Double], records: [String: (h: String, v: Any, o: Origin)])

  init?(payload: Data) {
    guard let object = (try? JSONValue.parseAny(payload)) as? [String: Any], object.int("v") == 1, let kind = object["kind"] as? String,
          let device = object["device"] as? String, let at = object.double("at") else { return nil }
    switch kind {
    case "log":
      guard let seq = object.int("seq"), let rawOps = object["ops"] as? [Any] else { return nil }
      var ops: [(key: String, h: String, v: Any)] = []
      ops.reserveCapacity(rawOps.count)
      for raw in rawOps {
        guard let op = raw as? [String: Any], let key = op["k"] as? String, let h = op["h"] as? String else { return nil }
        ops.append((key, h, op["v"] ?? NSNull()))
      }
      self = .log(device: device, seq: seq, at: at, ops: ops)
    case "snapshot":
      guard let rawVV = object["vv"] as? [String: Any], let rawSeen = object["seen"] as? [String: Any],
            let rawRecords = object["records"] as? [String: Any] else { return nil }
      var vv: [String: Int] = [:]
      for key in rawVV.keys {
        guard let seq = rawVV.int(key) else { return nil }
        vv[key] = seq
      }
      var seen: [String: Double] = [:]
      for key in rawSeen.keys {
        guard let at = rawSeen.double(key) else { return nil }
        seen[key] = at
      }
      var records: [String: (h: String, v: Any, o: Origin)] = [:]
      records.reserveCapacity(rawRecords.count)
      for (key, raw) in rawRecords {
        guard let record = raw as? [String: Any], let h = record["h"] as? String, let origin = record["o"] as? [Any], origin.count == 2,
              let originDevice = origin[0] as? String, let originSeq = ["s": origin[1]].int("s") else { return nil }
        records[key] = (h, record["v"] ?? NSNull(), Origin(device: originDevice, seq: originSeq))
      }
      self = .snapshot(device: device, at: at, vv: vv, seen: seen, records: records)
    default:
      return nil
    }
  }

  var isSnapshot: Bool {
    if case .snapshot = self { return true }
    return false
  }
}

struct ScopeReplica: Hashable, Sendable {
  static let damagedGiveUp: Double = 86_400_000

  var records: [String: SyncRecord] = [:]
  var vv: [String: Int] = [:]
  var extra: [String: [Int]] = [:]
  var files: [String: FileMeta] = [:]
  var damaged: [String: Double] = [:]
  var pendingSince: [String: Double]?
  var seen: [String: Double] = [:]
  var seq = 0
  var pending = 0

  static func covered(_ vv: [String: Int], _ origin: Origin) -> Bool {
    (vv[origin.device] ?? 0) >= origin.seq
  }

  func isApplied(_ origin: Origin) -> Bool {
    Self.covered(vv, origin) || (extra[origin.device]?.contains(origin.seq) ?? false)
  }

  mutating func markApplied(device: String, seq: Int) {
    if Self.covered(vv, Origin(device: device, seq: seq)) { return }
    var pending = Set(extra[device] ?? [])
    pending.insert(seq)
    var top = vv[device] ?? 0
    while pending.remove(top + 1) != nil { top += 1 }
    vv[device] = top
    extra[device] = pending.isEmpty ? nil : pending.sorted()
  }

  mutating func see(_ device: String, at: Double) {
    if let known = seen[device], !(at > known) { return }
    seen[device] = at
  }

  @discardableResult
  mutating func merge(_ key: String, _ record: SyncRecord, clock: inout HybridClock) -> Bool {
    clock.observe(record.h)
    if let current = records[key], jsAtLeast(current.h, record.h) { return false }
    records[key] = record
    return true
  }

  func visible(_ prefix: String) -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    for (key, record) in records where !record.v.isNull && key.hasPrefix(prefix) { out[key] = record.v }
    return out
  }

  func value(_ key: String) -> JSONValue? {
    guard let record = records[key], !record.v.isNull else { return nil }
    return record.v
  }

  var highestSeq: Int { seq }

  func highestSeq(of device: String) -> Int {
    max(vv[device] ?? 0, extra[device]?.max() ?? 0)
  }

  mutating func ingest(_ file: ParsedFile, clock: inout HybridClock, keep: (String) -> Bool) {
    switch file {
    case let .log(device, seq, at, ops):
      see(device, at: at)
      if isApplied(Origin(device: device, seq: seq)) { return }
      for op in ops {
        if keep(op.key) {
          merge(op.key, SyncRecord(h: op.h, v: JSONValue(any: op.v), o: Origin(device: device, seq: seq)), clock: &clock)
        } else {
          clock.observe(op.h)
        }
      }
      markApplied(device: device, seq: seq)
    case let .snapshot(device, at, fileVV, fileSeen, fileRecords):
      for (seenDevice, seenAt) in fileSeen { see(seenDevice, at: seenAt) }
      see(device, at: at)
      for (key, record) in fileRecords {
        if records[key] == nil && isApplied(record.o) { continue }
        if keep(key) {
          merge(key, SyncRecord(h: record.h, v: JSONValue(any: record.v), o: record.o), clock: &clock)
        } else {
          clock.observe(record.h)
        }
      }
      for (key, record) in records where fileRecords[key] == nil && Self.covered(fileVV, record.o) {
        records[key] = nil
      }
      for (fileDevice, fileSeq) in fileVV where fileSeq > (vv[fileDevice] ?? 0) {
        vv[fileDevice] = fileSeq
        var left = (extra[fileDevice] ?? []).filter { $0 > fileSeq }
        var top = fileSeq
        while let first = left.first, first == top + 1 {
          vv[fileDevice] = left.removeFirst()
          top += 1
        }
        extra[fileDevice] = left.isEmpty ? nil : left
      }
    }
  }

  mutating func pull(_ listing: FolderListing, now: Double, clock: inout HybridClock, keep: (String) -> Bool) {
    var parsed: [(id: String, file: ParsedFile)] = []
    func bad(_ id: String) {
      let since = min(damaged[id] ?? now, now)
      damaged[id] = since
      if now - since > Self.damagedGiveUp {
        files[id] = FileMeta(d: "", k: .bad, at: now)
        damaged[id] = nil
      }
    }
    for listed in listing.files {
      if let file = ParsedFile(payload: listed.payload) {
        parsed.append((listed.id, file))
      } else {
        bad(listed.id)
      }
    }
    for id in listing.damaged { bad(id) }
    let ordered = parsed.filter { $0.file.isSnapshot } + parsed.filter { !$0.file.isSnapshot }
    for (id, file) in ordered {
      ingest(file, clock: &clock, keep: keep)
      switch file {
      case let .snapshot(device, at, fileVV, _, _):
        files[id] = FileMeta(d: device, k: .snapshot, vv: fileVV, at: at)
      case let .log(device, seq, at, _):
        files[id] = FileMeta(d: device, k: .log, s: seq, at: at)
      }
      damaged[id] = nil
    }
    let present = Set(listing.present)
    for id in files.keys where !present.contains(id) { files[id] = nil }
    for id in damaged.keys where !present.contains(id) { damaged[id] = nil }
    pending = listing.pending.count
    var since: [String: Double] = [:]
    for id in listing.pending { since[id] = min(pendingSince?[id] ?? now, now) }
    pendingSince = listing.pending.isEmpty ? nil : since
  }

  mutating func restore(_ batch: LogFile, clock: inout HybridClock) {
    guard batch.seq > seq else { return }
    for op in batch.ops {
      merge(op.k, SyncRecord(h: op.h, v: op.v, o: Origin(device: batch.device, seq: batch.seq)), clock: &clock)
    }
    seq = batch.seq
  }

  mutating func written(_ batch: LogFile, id: String, now: Double) {
    files[id] = FileMeta(d: batch.device, k: .log, s: batch.seq, at: batch.at)
    markApplied(device: batch.device, seq: batch.seq)
    see(batch.device, at: now)
  }
}
