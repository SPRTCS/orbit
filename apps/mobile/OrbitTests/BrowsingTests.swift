import Foundation
import Testing
import UIKit
import WebKit

@testable import Orbit

@MainActor
private func makeBrowser() -> BrowserModel {
  let root = FileManager.default.temporaryDirectory.appending(path: "OrbitTests-\(UUID().uuidString)")
  return BrowserModel(
    persistence: TabPersistence(directory: root),
    settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
    syncClient: PreviewSync(), downloads: DownloadStore(directory: root.appending(path: "Downloads")))
}

@MainActor
private func loadedUserAgent(in browser: BrowserModel, host: String) async throws -> String {
  let tab = browser.openNewTab(with: nil)
  let webView = browser.ensureLive(tab)
  webView.loadHTMLString("<title>ready</title><p>page</p>", baseURL: URL(string: "https://\(host)/"))
  for _ in 0..<1600 where webView.title != "ready" { try await Task.sleep(for: .milliseconds(25)) }
  let agent = try await webView.callAsyncJavaScript("return navigator.userAgent", contentWorld: .page)
  return agent as? String ?? ""
}

@MainActor
struct SiteModeTests {
  @Test func desktopSitesNeverSeeAMobileToken() {
    let agent = SiteMode.desktopUserAgent(osMajor: 27)
    #expect(agent.contains("Macintosh") && agent.contains("Version/27.0 Safari/"))
    #expect(!agent.contains("Mobile"))
    #expect(SiteMode.mobileApplicationName(osMajor: 27) == "Version/27.0 Mobile/15E148 Safari/604.1")
  }

  @Test func onlyFullWidthIPadsDefaultToDesktop() {
    #expect(SiteMode.automatic(isPad: true, isCompactLayout: false) == .desktop)
    #expect(SiteMode.automatic(isPad: true, isCompactLayout: true) == .mobile)
    #expect(SiteMode.automatic(isPad: false, isCompactLayout: false) == .mobile)
  }

  @Test func requestedDesktopSiteGetsTheDesktopAgent() async throws {
    let browser = makeBrowser()
    browser.settings.setSiteMode(.desktop, forHost: "desktop.example")
    browser.settings.setSiteMode(.mobile, forHost: "mobile.example")
    let desktop = try await loadedUserAgent(in: browser, host: "desktop.example")
    #expect(desktop.contains("Macintosh") && !desktop.contains("Mobile"))
    let mobile = try await loadedUserAgent(in: browser, host: "mobile.example")
    #expect(mobile.contains("Mobile/15E148") && !mobile.contains("Macintosh"))
  }

  @Test func siteModeIsRememberedPerHostAndPrivateTabsStayOffTheRecord() {
    let browser = makeBrowser()
    browser.isCompactLayout = true
    let tab = browser.openNewTab(with: URL(string: "https://news.example/a"))
    #expect(browser.selectedSiteMode == .mobile)
    browser.toggleSiteMode()
    #expect(browser.settings.siteMode(forHost: "news.example") == .desktop)
    #expect(browser.siteMode(for: URL(string: "https://news.example/b")!, in: tab) == .desktop)
    browser.toggleSiteMode()
    #expect(browser.settings.siteMode(forHost: "news.example") == nil)
    let hidden = browser.openNewTab(with: URL(string: "https://secret.example/"), isPrivate: true)
    browser.toggleSiteMode()
    #expect(hidden.siteModeOverride == .desktop)
    #expect(browser.settings.siteMode(forHost: "secret.example") == nil)
  }

  @Test func zoomStepsStayInRangeAndResetForgetsTheHost() {
    #expect(PageZoom.stepped(1, by: 1) == 1.15)
    #expect(PageZoom.stepped(1, by: -1) == 0.85)
    #expect(PageZoom.stepped(3, by: 1) == 3)
    #expect(PageZoom.stepped(0.5, by: -1) == 0.5)
    #expect(PageZoom.label(1.25) == "125%")
    let browser = makeBrowser()
    browser.openNewTab(with: URL(string: "https://zoom.example/"))
    browser.zoomPage(by: 1)
    #expect(browser.selectedPageZoom == 1.15)
    browser.setPageZoom(1)
    #expect(browser.settings.pageZooms.isEmpty)
  }
}

struct DownloadPolicyTests {
  @Test func attachmentsAndUnshowableMainFramesDownload() {
    #expect(DownloadPolicy.shouldDownload(canShowMIMEType: true, contentDisposition: "attachment; filename=a.pdf", isMainFrame: true))
    #expect(DownloadPolicy.shouldDownload(canShowMIMEType: true, contentDisposition: "Attachment", isMainFrame: false))
    #expect(DownloadPolicy.shouldDownload(canShowMIMEType: false, contentDisposition: nil, isMainFrame: true))
    #expect(!DownloadPolicy.shouldDownload(canShowMIMEType: false, contentDisposition: nil, isMainFrame: false))
    #expect(!DownloadPolicy.shouldDownload(canShowMIMEType: true, contentDisposition: "inline", isMainFrame: true))
  }

  @Test func destinationsStayInsideTheFolderAndNeverOverwrite() {
    let folder = URL(filePath: "/tmp/Downloads", directoryHint: .isDirectory)
    let taken: Set<String> = ["report.pdf", "report 2.pdf", "archive"]
    let exists: (URL) -> Bool = { taken.contains($0.lastPathComponent) }
    #expect(DownloadPolicy.uniqueURL(named: "new.zip", in: folder, exists: exists).lastPathComponent == "new.zip")
    #expect(DownloadPolicy.uniqueURL(named: "report.pdf", in: folder, exists: exists).lastPathComponent == "report 3.pdf")
    #expect(DownloadPolicy.uniqueURL(named: "archive", in: folder, exists: exists).lastPathComponent == "archive 2")
    let escaped = DownloadPolicy.uniqueURL(named: "../../etc/passwd", in: folder, exists: exists)
    #expect(escaped.deletingLastPathComponent().lastPathComponent == "Downloads")
    #expect(!escaped.lastPathComponent.contains("/"))
    #expect(DownloadPolicy.sanitized("  ") == "Download")
    #expect(DownloadPolicy.sanitized(".hidden") == "hidden")
  }

  @MainActor @Test func finishedFilesAreListedNewestFirstAndDeletable() throws {
    let folder = FileManager.default.temporaryDirectory.appending(path: "OrbitDownloads-\(UUID().uuidString)")
    let store = DownloadStore(directory: folder)
    #expect(store.files.isEmpty)
    try Data("a".utf8).write(to: folder.appending(path: "old.txt"))
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -600)], ofItemAtPath: folder.appending(path: "old.txt").path)
    try Data("bb".utf8).write(to: folder.appending(path: "new.txt"))
    store.reload()
    #expect(store.files.map(\.name) == ["new.txt", "old.txt"])
    #expect(store.files.first?.size == 2)
    store.delete(store.files[0])
    #expect(store.files.map(\.name) == ["old.txt"])
    store.deleteAll()
    #expect(store.files.isEmpty)
    #expect(!FileManager.default.fileExists(atPath: folder.appending(path: "old.txt").path))
  }
}

@MainActor
struct HistoryAndClosedTabTests {
  @Test func historyGroupsByDayNewestFirst() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let noon = Date(timeIntervalSince1970: TimeInterval(1_800_000_000 / 86_400 * 86_400 + 43_200))
    func entry(_ path: String, _ offset: TimeInterval) -> HistoryEntry {
      HistoryEntry(url: URL(string: "https://a.example/\(path)")!, title: path, lastVisit: noon.addingTimeInterval(offset), visitCount: 1)
    }
    let days = HistoryDay.grouped([entry("old", -90_000), entry("early", -3_600), entry("late", 60)], calendar: calendar)
    #expect(days.map { $0.entries.map(\.title) } == [["late", "early"], ["old"]])
  }

  @Test func frequentSitesAreOnePerHostAndSkipSearches() {
    let browser = makeBrowser()
    let history = browser.history
    let docs = URL(string: "https://docs.example/guide")!
    for _ in 0..<3 { history.recordVisit(url: docs, title: "Guide") }
    history.recordVisit(url: URL(string: "https://docs.example/other")!, title: "Other")
    history.recordVisit(url: URL(string: "https://once.example/")!, title: "Once")
    let search = SearchEngine.google.searchURL(for: "swift")
    for _ in 0..<5 { history.recordVisit(url: search, title: "swift") }
    #expect(history.frequent(limit: 8).map(\.url) == [docs])
    history.remove(docs)
    #expect(history.all().contains { $0.url == docs } == false)
  }

  @Test func closingEverythingCanBeUndone() {
    let browser = makeBrowser()
    browser.openNewTab(with: URL(string: "https://one.example/"))
    browser.openNewTab(with: URL(string: "https://two.example/"))
    browser.openNewTab(with: URL(string: "https://secret.example/"), isPrivate: true)
    browser.closeAllTabs()
    #expect(browser.tabs.isEmpty)
    #expect(browser.recentlyClosed.compactMap(\.url?.host) == ["one.example", "two.example"])
    browser.toast?.action?()
    #expect(browser.tabs.compactMap(\.url?.host) == ["one.example", "two.example"])
    #expect(browser.selectedTab != nil)
    #expect(!browser.canReopenClosedTab)
  }

  @Test func swipingTheAddressBarWalksPinnedTabsToo() {
    let browser = makeBrowser()
    let first = browser.openNewTab(with: URL(string: "https://one.example/"))
    let second = browser.openNewTab(with: URL(string: "https://two.example/"))
    browser.select(first)
    #expect(browser.hasNextTab)
    browser.selectAdjacent(1, wrap: false)
    #expect(browser.selectedTabID == second.id)
    #expect(!browser.hasNextTab)
  }
}
