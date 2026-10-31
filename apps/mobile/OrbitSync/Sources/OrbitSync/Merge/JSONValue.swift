import CoreFoundation
import Foundation

enum JSONValue: Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  static func parse(_ data: Data) throws -> JSONValue {
    JSONValue(any: try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
  }

  static func parseAny(_ data: Data) throws -> Any {
    try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
  }

  init(any: Any) {
    switch any {
    case let number as NSNumber:
      self = CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
    case let string as String:
      self = .string(string)
    case let array as [Any]:
      self = .array(array.map(JSONValue.init(any:)))
    case let object as [String: Any]:
      self = .object(object.mapValues(JSONValue.init(any:)))
    default:
      self = .null
    }
  }

  subscript(key: String) -> JSONValue? {
    if case .object(let object) = self { return object[key] }
    return nil
  }

  var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  var number: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  var bool: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  var array: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }

  var object: [String: JSONValue]? {
    if case .object(let value) = self { return value }
    return nil
  }

  var isNull: Bool { self == .null }

  var serialized: String {
    var out = ""
    write(to: &out)
    return out
  }

  var data: Data { Data(serialized.utf8) }

  func write(to out: inout String) {
    switch self {
    case .null:
      out += "null"
    case .bool(let value):
      out += value ? "true" : "false"
    case .number(let value):
      out += Self.format(value)
    case .string(let value):
      Self.quote(value, into: &out)
    case .array(let values):
      out += "["
      for (index, value) in values.enumerated() {
        if index > 0 { out += "," }
        value.write(to: &out)
      }
      out += "]"
    case .object(let object):
      out += "{"
      for (index, key) in object.keys.sorted(by: jsLess).enumerated() {
        if index > 0 { out += "," }
        Self.quote(key, into: &out)
        out += ":"
        object[key]!.write(to: &out)
      }
      out += "}"
    }
  }

  static func format(_ value: Double) -> String {
    guard value.isFinite else { return "null" }
    if value == value.rounded(), abs(value) < 9_007_199_254_740_992 { return String(Int64(value)) }
    return "\(value)"
  }

  static func quote(_ string: String, into out: inout String) {
    out += "\""
    for scalar in string.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{8}": out += "\\b"
      case "\u{c}": out += "\\f"
      default:
        if scalar.value < 0x20 {
          out += "\\u" + String(repeating: "0", count: 4 - String(scalar.value, radix: 16).count) + String(scalar.value, radix: 16)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }
}

func jsLess(_ a: String, _ b: String) -> Bool {
  a.utf16.lexicographicallyPrecedes(b.utf16)
}

func jsAtLeast(_ a: String, _ b: String) -> Bool {
  !jsLess(a, b)
}

extension Dictionary where Key == String, Value == Any {
  func int(_ key: String) -> Int? {
    guard let number = self[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let value = number.doubleValue
    guard value == value.rounded(), abs(value) < 9_007_199_254_740_992 else { return nil }
    return Int(value)
  }

  func double(_ key: String) -> Double? {
    guard let number = self[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return number.doubleValue
  }
}
