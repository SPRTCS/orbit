import Foundation

struct HybridClock: Sendable {
  static let wallDigits = 9
  static let counterDigits = 4

  let device: String
  private(set) var wall: Int64 = 0
  private(set) var counter: Int64 = 0

  init(device: String, last: String? = nil) {
    self.device = device
    if let last { observe(last) }
  }

  mutating func tick(now: Int64) -> String {
    if now > wall {
      wall = now
      counter = 0
    } else {
      counter += 1
    }
    return Self.format(wall: wall, counter: counter, device: device)
  }

  mutating func observe(_ hlc: String) {
    let parts = hlc.split(separator: ".", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count >= 2, let wall = Int64(parts[0], radix: 36), let counter = Int64(parts[1], radix: 36) else { return }
    if wall > self.wall || (wall == self.wall && counter > self.counter) {
      self.wall = wall
      self.counter = counter
    }
  }

  var last: String { Self.format(wall: wall, counter: counter, device: device) }

  static func format(wall: Int64, counter: Int64, device: String) -> String {
    pad(String(max(0, wall), radix: 36), wallDigits) + "." + pad(String(counter, radix: 36), counterDigits) + "." + device
  }

  static func wall(of hlc: String) -> Int64 {
    Int64(String(hlc.prefix(wallDigits)), radix: 36) ?? 0
  }

  private static func pad(_ digits: String, _ width: Int) -> String {
    digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
  }
}
