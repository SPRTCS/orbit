import AppKit
import Darwin

enum OrbitLinkSource {
  static var pending: String?

  static func sender() -> String? {
    guard let event = NSAppleEventManager.shared().currentAppleEvent else { return nil }
    let opensLinks =
      (event.eventClass == AEEventClass(kInternetEventClass) && event.eventID == AEEventID(kAEGetURL))
      || (event.eventClass == AEEventClass(kCoreEventClass) && event.eventID == AEEventID(kAEOpenDocuments))
    guard opensLinks, let pid = event.attributeDescriptor(forKeyword: AEKeyword(keySenderPIDAttr))?.int32Value,
      pid > 0, pid != getpid()
    else { return nil }
    return bundleIdentifier(of: pid)
  }

  static func bundleIdentifier(of pid: pid_t) -> String? {
    if let id = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier { return id }
    var path = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { return nil }
    var url = URL(fileURLWithPath: String(cString: path))
    var outermost: URL?
    while url.pathComponents.count > 1 {
      url.deleteLastPathComponent()
      if url.pathExtension == "app" { outermost = url }
    }
    return outermost.flatMap { Bundle(url: $0)?.bundleIdentifier }
  }

  static func hold(_ source: String?, joining waiting: Bool) {
    pending = waiting && pending != source ? nil : source
  }

  static func payload(_ urls: [String], from source: String?) -> [String: Any] {
    guard let source else { return ["urls": urls] }
    return ["urls": urls, "sourceApp": source]
  }
}
