import Foundation

extension Origin {
  var json: JSONValue { .array([.string(device), .number(Double(seq))]) }

  init?(json: JSONValue?) {
    guard let parts = json?.array, parts.count == 2, let device = parts[0].string, let seq = parts[1].number else { return nil }
    self.init(device: device, seq: Int(seq))
  }
}

extension SyncOp {
  var json: JSONValue { .object(["k": .string(k), "h": .string(h), "v": v]) }

  init?(json: JSONValue) {
    guard let k = json["k"]?.string, let h = json["h"]?.string else { return nil }
    self.init(k: k, h: h, v: json["v"] ?? .null)
  }
}

extension LogFile {
  init?(json: JSONValue) {
    guard let device = json["device"]?.string, let seq = json["seq"]?.number, let at = json["at"]?.number,
          let ops = json["ops"]?.array?.compactMap(SyncOp.init(json:)) else { return nil }
    self.init(device: device, seq: Int(seq), at: at, ops: ops)
  }
}

extension FileMeta {
  var json: JSONValue {
    var object: [String: JSONValue] = ["d": .string(d), "k": .string(k.rawValue), "at": .number(at)]
    if let s { object["s"] = .number(Double(s)) }
    if let vv { object["vv"] = .object(vv.mapValues { .number(Double($0)) }) }
    return .object(object)
  }

  init?(json: JSONValue) {
    guard let d = json["d"]?.string, let kind = json["k"]?.string.flatMap(Kind.init(rawValue:)), let at = json["at"]?.number else { return nil }
    self.init(d: d, k: kind, s: json["s"]?.number.map { Int($0) }, vv: json["vv"]?.object?.compactMapValues { $0.number.map { Int($0) } }, at: at)
  }
}

extension ScopeReplica {
  var json: JSONValue {
    var object: [String: JSONValue] = [
      "records": .object(records.mapValues { .object(["h": .string($0.h), "v": $0.v, "o": $0.o.json]) }),
      "vv": .object(vv.mapValues { .number(Double($0)) }),
      "extra": .object(extra.mapValues { .array($0.map { .number(Double($0)) }) }),
      "files": .object(files.mapValues(\.json)),
      "damaged": .object(damaged.mapValues { .number($0) }),
      "seen": .object(seen.mapValues { .number($0) }),
      "seq": .number(Double(seq)),
      "pending": .number(Double(pending)),
    ]
    if let pendingSince { object["pendingSince"] = .object(pendingSince.mapValues { .number($0) }) }
    return .object(object)
  }

  init(json: JSONValue) {
    self.init()
    for (key, value) in json["records"]?.object ?? [:] {
      guard let h = value["h"]?.string, let origin = Origin(json: value["o"]) else { continue }
      records[key] = SyncRecord(h: h, v: value["v"] ?? .null, o: origin)
    }
    vv = json["vv"]?.object?.compactMapValues { $0.number.map { Int($0) } } ?? [:]
    extra = json["extra"]?.object?.compactMapValues { $0.array?.compactMap { $0.number.map { Int($0) } } } ?? [:]
    files = json["files"]?.object?.compactMapValues(FileMeta.init(json:)) ?? [:]
    damaged = json["damaged"]?.object?.compactMapValues(\.number) ?? [:]
    seen = json["seen"]?.object?.compactMapValues(\.number) ?? [:]
    pendingSince = json["pendingSince"]?.object?.compactMapValues(\.number)
    seq = Int(json["seq"]?.number ?? 0)
    pending = Int(json["pending"]?.number ?? 0)
  }
}
