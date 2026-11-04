import Foundation
import OrbitSync
import SwiftUI
import Testing
import UIKit

@testable import Orbit

struct LayoutTests {
  @Test(arguments: [(220.0, 2), (240.0, 3), (290.0, 3), (399.0, 3), (400.0, 4), (420.0, 4)])
  func pinTileColumnsFollowSidebarWidth(width: Double, columns: Int) {
    #expect(SidebarWidth.tileColumns(forSidebarWidth: CGFloat(width)) == columns)
  }

  @Test func sidebarWidthRangeIsClampedToFortyPercent() {
    #expect(SidebarWidth.range(windowWidth: 1366) == 240...420)
    #expect(SidebarWidth.range(windowWidth: 800) == 240...320)
    #expect(SidebarWidth.range(windowWidth: 500) == 240...240)
  }

  @Test func compactBarCollapsesToASmallLowPill() {
    let metrics = ChromeMetrics.compact(safeBottom: 34, width: 402)
    #expect(metrics.pillWidth == (402 * 0.45))
    #expect(metrics.pillBottomPadding < metrics.barBottomPadding)
    #expect(metrics.collapsedObscured < metrics.expandedObscured)
    #expect(metrics.obscured(collapsed: true) == metrics.pillBottomPadding + MinimizedAddressPill.height + 6)
    let homeButton = ChromeMetrics.compact(safeBottom: 0, width: 375)
    #expect(homeButton.pillBottomPadding == 6)
    #expect(homeButton.barBottomPadding == 10)
  }

  @Test func bottomRowSitsAtTheSameGapFromBottomAndSides() {
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 55, controlSize: 50, safeBottom: 34) == 36)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 70, controlSize: 50, safeBottom: 34) == 39)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 18, controlSize: 46, safeBottom: 20) == 22)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 0, controlSize: 50, safeBottom: 0) == 20)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 480, controlSize: 46, safeBottom: 20) == 41)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 18, controlSize: 46, safeBottom: 400) == 42)
    #expect(ChromeMetrics.displayCornerRadius(isPad: true, safeBottom: 20) == 18)
    #expect(ChromeMetrics.displayCornerRadius(isPad: false, safeBottom: 34) == 55)
    #expect(ChromeMetrics.displayCornerRadius(isPad: false, safeBottom: 0) == 0)

    let phone = ChromeMetrics.compact(safeBottom: 34, width: 402, displayCornerRadius: 55)
    #expect(phone.barBottomPadding == 36)
    #expect(phone.horizontalPadding == 36)

    let pad = ChromeMetrics.regular(edgeGap: 22, cardInset: 8, safeBottom: 20, width: 900)
    #expect(pad.barHeight == ChromeMetrics.regularControlSize)
    #expect(pad.barBottomPadding + 8 == 22)
    #expect(pad.horizontalPadding + 8 == 22)
    #expect(pad.pillWidth == 288)
  }

  @Test func morphTargetsTheCardOrThePlusButton() {
    let morph = OverviewMorph()
    let id = UUID()
    let card = CGRect(x: 20, y: 100, width: 160, height: 216)
    morph.cardFrames[id] = card
    morph.start(.opening, tabID: id, image: nil, progress: 0)
    #expect(morph.targetFrame == card)
    #expect(morph.hidesCard(of: id))
    #expect(morph.overviewOpacity == 0)
    morph.progress = 0.5
    #expect(morph.overviewOpacity == 0.5)

    let plus = CGRect(x: 330, y: 780, width: 50, height: 50)
    morph.start(.growing, tabID: id, image: nil, progress: 1, sourceFrame: plus)
    #expect(morph.targetFrame == plus)
    #expect(!morph.hidesCard(of: id))
    #expect(morph.overviewOpacity == 1)

    morph.finish()
    #expect(!morph.isActive)
    #expect(morph.targetFrame == nil)
  }
}

struct RegularLayoutTests {
  private func layout(width: CGFloat, sidebar: Bool, overview: Bool = false, stored: CGFloat = 290) -> RegularLayout {
    RegularLayout(
      windowWidth: width, safeArea: EdgeInsets(top: 24, leading: 0, bottom: 20, trailing: 0),
      storedSidebarWidth: stored, isSidebarVisible: sidebar, isShowingOverview: overview,
      displayCornerRadius: ChromeMetrics.displayCornerRadius(isPad: true, safeBottom: 20))
  }

  @Test func portraitWithSidebarFitsTheWindow() {
    let portrait = layout(width: 834, sidebar: true)
    #expect(portrait.sidebarWidth == 290)
    #expect(portrait.cardLeading == 300)
    #expect(portrait.cardWidth == 526)
    #expect(portrait.cardLeading + portrait.cardWidth + RegularLayout.cardInset == 834)
    #expect(portrait.edgeGap == 22)
    #expect(portrait.entryLeadingInset == 300)
  }

  @Test func landscapeWithSidebarFitsTheWindow() {
    let landscape = layout(width: 1210, sidebar: true, stored: 420)
    #expect(landscape.sidebarWidth == 420)
    #expect(landscape.cardWidth == CGFloat(772))
    #expect(landscape.edgeGap == 22)
  }

  @Test func storedWidthIsClampedToTheWindow() {
    let narrow = layout(width: 700, sidebar: true, stored: 420)
    #expect(narrow.sidebarWidth == 280)
    #expect(narrow.cardWidth == CGFloat(402))
    let tooSmall = layout(width: 1210, sidebar: true, stored: 100)
    #expect(tooSmall.sidebarWidth == 240)
  }

  @Test func hiddenSidebarGivesEvenCardInsets() {
    for width in [834.0, 1210.0] {
      let hidden = layout(width: CGFloat(width), sidebar: false)
      #expect(hidden.cardLeading == RegularLayout.cardInset)
      #expect(hidden.cardWidth == CGFloat(width) - 16)
      #expect(hidden.entryLeadingInset == 0)
    }
  }

  @Test func entrySpansTheWindowOverTheOverview() {
    #expect(layout(width: 834, sidebar: true, overview: true).entryLeadingInset == 0)
  }

  @Test func keyboardOverlapCoversDockedFloatingAndHidden() {
    let window = CGRect(x: 0, y: 0, width: 834, height: 1210)
    #expect(KeyboardMetrics.overlap(viewBounds: window, keyboardFrame: CGRect(x: 0, y: 871, width: 834, height: 339)) == 339)
    #expect(KeyboardMetrics.overlap(viewBounds: window, keyboardFrame: CGRect(x: 0, y: 1210, width: 834, height: 0)) == 0)
    #expect(KeyboardMetrics.overlap(viewBounds: window, keyboardFrame: CGRect(x: 0, y: 1155, width: 834, height: 55)) == 55)
    #expect(KeyboardMetrics.overlap(viewBounds: window, keyboardFrame: CGRect(x: 200, y: 700, width: 320, height: 250)) == 510)
    #expect(KeyboardMetrics.entryBottomPadding(overlap: 0, safeBottom: 20, margin: 12) == 32)
    #expect(KeyboardMetrics.entryBottomPadding(overlap: 339, safeBottom: 20, margin: 12) == 351)
  }
}

struct SidebarDockTests {
  @Test func narrowDragSnapsIntoTheDockAndWideDragSnapsBack() {
    let range = SidebarWidth.range(windowWidth: 1210)
    #expect(SidebarWidth.resized(from: 290, by: -40, range: range) == 250)
    #expect(SidebarWidth.resized(from: 290, by: -60, range: range) == 240)
    #expect(SidebarWidth.resized(from: 290, by: -121, range: range) == SidebarWidth.dock)
    #expect(SidebarWidth.resized(from: SidebarWidth.dock, by: 60, range: range) == SidebarWidth.dock)
    #expect(SidebarWidth.resized(from: SidebarWidth.dock, by: 110, range: range) == 240)
    #expect(SidebarWidth.stepped(240, by: -20, range: range) == SidebarWidth.dock)
    #expect(SidebarWidth.stepped(SidebarWidth.dock, by: 20, range: range) == 240)
  }

  @Test func dockLayoutKeepsTheIconColumnBesideTheCard() {
    let dock = RegularLayout(
      windowWidth: 1210, safeArea: EdgeInsets(top: 24, leading: 0, bottom: 20, trailing: 0),
      storedSidebarWidth: SidebarWidth.dock, isSidebarVisible: true, isShowingOverview: false,
      displayCornerRadius: ChromeMetrics.displayCornerRadius(isPad: true, safeBottom: 20))
    #expect(dock.isDock)
    #expect(dock.sidebarWidth == 72)
    #expect(dock.cardLeading == 82)
    #expect(dock.cardLeading + dock.cardWidth + RegularLayout.cardInset == 1210)
    let notched = RegularLayout(
      windowWidth: 956, safeArea: EdgeInsets(top: 0, leading: 62, bottom: 21, trailing: 62),
      storedSidebarWidth: SidebarWidth.dock, isSidebarVisible: true, isShowingOverview: false,
      displayCornerRadius: 55)
    #expect(notched.sidebarWidth == 134)
  }

  @Test func iconsShowAtMostTwelvePerScreenAndNeverShrinkBelowTheMinimum() {
    let tall = DockMagnification(separators: Array(repeating: false, count: 30), viewportHeight: 1000)
    #expect(tall.tile == DockMagnification.maximumTile)
    let short = DockMagnification(separators: Array(repeating: false, count: 30), viewportHeight: 420)
    #expect(short.tile == DockMagnification.minimumTile)
    #expect(short.restHeight > 420)
    let fitted = DockMagnification(separators: [], viewportHeight: 600)
    #expect(fitted.tile * 12 + DockMagnification.spacing * 11 + DockMagnification.padding * 2 <= 600)
    #expect(fitted.tile >= DockMagnification.minimumTile && fitted.tile <= DockMagnification.maximumTile)
    #expect(abs(short.layout(focus: short.rest[10].center)[10].size - short.peak) < 0.001)
    #expect(short.peak == DockMagnification.peakSize)
  }

  @Test func pinsAndFoldersOpenAsPagesWithTheirOwnIcons() {
    let folders = [
      SyncedFolder(id: "tax", name: "Steuer", path: ["Steuer"], parentId: nil, emoji: "💰", color: nil),
      SyncedFolder(id: "2026", name: "2026", path: ["Steuer", "2026"], parentId: "tax", emoji: nil, color: nil),
    ]
    let pins = [
      SyncedPin(id: "t", title: "Tile", url: URL(string: "https://a.example"), groupId: nil, folderPath: [], isTile: true),
      SyncedPin(id: "r", title: "Row", url: URL(string: "https://b.example"), groupId: nil, folderPath: []),
      SyncedPin(id: "e", title: "Elster", url: URL(string: "https://c.example"), groupId: nil, folderPath: [], folderId: "tax"),
      SyncedPin(id: "x", title: "Beleg", url: URL(string: "https://d.example"), groupId: nil, folderPath: [], folderId: "2026"),
    ]
    let tree = PinTree(pins: pins, folders: folders)
    #expect(DockItem.items(of: .pins, in: tree)?.map(\.id) == ["pin:t", "pin:r", "folder:tax"])
    #expect(DockItem.items(of: .folder("tax"), in: tree)?.map(\.id) == ["pin:e", "folder:2026"])
    #expect(DockItem.items(of: .folder("2026"), in: tree)?.map(\.id) == ["pin:x"])
    #expect(DockItem.items(of: .folder("gone"), in: tree) == nil)
    #expect(DockItem.items(of: .pins, in: tree)?.last?.opensPage == .folder("tax"))
  }

  @Test func theIconUnderTheFingerGrowsMostAndStaysUnderIt() {
    let dock = DockMagnification(separators: [false, false, true, false, false, false], viewportHeight: 900)
    let rest = dock.rest
    #expect(dock.layout(focus: nil) == rest)
    let focus = rest[3].center
    let grown = dock.layout(focus: focus)
    #expect(abs(grown[3].size - dock.peak) < 0.001)
    #expect(dock.peak >= DockMagnification.peakSize)
    #expect(abs(grown[3].center - focus) < 0.001)
    #expect(grown[4].size < grown[3].size && grown[4].size > dock.tile)
    let even = DockMagnification(separators: Array(repeating: false, count: 5), viewportHeight: 900)
    let around = even.layout(focus: even.rest[2].center)
    #expect(abs(around[1].size - around[3].size) < 0.001)
    #expect(abs((around[2].center - around[1].center) - (around[3].center - around[2].center)) < 0.001)
    #expect(grown[2].size == DockMagnification.separatorHeight)
    #expect(grown[0].center < rest[0].center)
    #expect(grown[5].center > rest[5].center)
    for i in 1..<grown.count { #expect(grown[i].center > grown[i - 1].center) }
  }

  @Test func fingerPicksTheNearestIconNeverTheSeparator() {
    let dock = DockMagnification(separators: [false, true, false], viewportHeight: 900)
    let rest = dock.rest
    #expect(dock.index(at: rest[0].center) == 0)
    #expect(dock.index(at: rest[1].center + 1) == 2)
    #expect(dock.index(at: rest[2].center + 10) == 2)
    #expect(dock.index(at: -40) == nil)
    #expect(dock.index(at: dock.restHeight + 40) == nil)
  }
}

struct SidebarLayoutTests {
  @Test func topRowMirrorsTheFooterCorner() {
    let gap: CGFloat = 22
    let footerLeft = SidebarLayout.footerLeading(edgeGap: gap, safeLeading: 0)
    let footerCenter = footerLeft + ChromeMetrics.regularControlSize / 2
    let toggleLeft = SidebarLayout.topRowLeading(edgeGap: gap, safeLeading: 0, cornerAdaptedLeading: 20)
    let toggleTop = SidebarLayout.topRowInset(edgeGap: gap)
    #expect(toggleLeft + SidebarLayout.iconButtonSize / 2 == footerCenter)
    #expect(toggleTop + SidebarLayout.iconButtonSize / 2 == gap + ChromeMetrics.regularControlSize / 2)
    #expect(toggleTop == 23)
    #expect(SidebarLayout.iconButtonSize >= 44)
  }

  @Test func topRowClearsStageManagerWindowControls() {
    #expect(SidebarLayout.topRowLeading(edgeGap: 22, safeLeading: 0, cornerAdaptedLeading: 84) == 84)
    #expect(SidebarLayout.topRowLeading(edgeGap: 22, safeLeading: 0, cornerAdaptedLeading: 24) == 23)
  }

  @Test func topRowStaysBelowAStatusBarAcrossTheTop() {
    #expect(SidebarLayout.topRowInset(edgeGap: 36, statusBarOverlap: 0) == 37)
    #expect(SidebarLayout.topRowInset(edgeGap: 36, statusBarOverlap: 54) == 58)
    #expect(SidebarLayout.topRowInset(edgeGap: 22, statusBarOverlap: 24) == 28)
  }
}

struct OverviewBarTests {
  @Test func iPadOverviewShowsThreeByTwoInLandscapeAndTwoByThreeInPortrait() {
    let landscape = RegularOverviewGrid(width: 1154, height: 708)
    #expect(landscape.columns == 3)
    let landscapeCardWidth = (1154 - 2 * RegularOverviewGrid.columnSpacing) / 3
    let landscapeRows = (landscapeCardWidth / landscape.cardAspect + RegularOverviewGrid.titleHeight) * 2 + RegularOverviewGrid.rowSpacing
    #expect(abs(landscapeRows - 708) < 1)
    let portrait = RegularOverviewGrid(width: 778, height: 1084)
    #expect(portrait.columns == 2)
    #expect(portrait.cardAspect > 1)
  }
  @Test(arguments: [375.0, 402.0, 430.0, 500.0, 600.0, 700.0])
  func doneNeverOverlapsTheLeadingButtons(width: Double) {
    let gap = ChromeMetrics.edgeGap(displayCornerRadius: 55, controlSize: 50, safeBottom: 34)
    let inset = ChromeMetrics.horizontalInset(edgeGap: gap, safeLeading: 0, safeTrailing: 0)
    let barWidth = CGFloat(width) - 2 * inset
    let leadingEnd = 2 * 50 + OverviewBarLayout.spacing
    if OverviewBarLayout.centersDone(barWidth: barWidth, buttonSize: 50) {
      #expect(leadingEnd + OverviewBarLayout.clearance <= (barWidth - OverviewBarLayout.doneWidth) / 2)
    } else {
      #expect(leadingEnd + OverviewBarLayout.doneWidth + 50 + 2 * OverviewBarLayout.clearance <= barWidth)
    }
  }

  @Test func centersDoneOnWideBars() {
    #expect(OverviewBarLayout.centersDone(barWidth: 340, buttonSize: 50))
    #expect(!OverviewBarLayout.centersDone(barWidth: 300, buttonSize: 50))
  }

  @Test func statusStripDoesNotPushTheBarInward() {
    #expect(ChromeMetrics.horizontalInset(edgeGap: 36, safeLeading: 0, safeTrailing: 92) == 36)
    #expect(ChromeMetrics.horizontalInset(edgeGap: 36, safeLeading: 62, safeTrailing: 62) == 62)
    #expect(ChromeMetrics.horizontalInset(edgeGap: 20, safeLeading: 0, safeTrailing: 0) == 20)
  }

  @Test func everyEdgeGapIsAtLeastTwentyPoints() {
    for safeBottom in [0.0, 20.0, 34.0] {
      for radius in [0.0, 18.0, 55.0, 400.0] {
        #expect(ChromeMetrics.edgeGap(displayCornerRadius: CGFloat(radius), controlSize: 46, safeBottom: CGFloat(safeBottom)) >= 20)
      }
    }
  }
}

struct OverviewGestureTests {
  @Test func pinchProgressFollowsTheFingers() {
    #expect(OverviewMorph.pinchProgress(scale: 1, targetScale: 0.3) == 0)
    #expect(OverviewMorph.pinchProgress(scale: 0.65, targetScale: 0.3) == 0.5)
    #expect(OverviewMorph.pinchProgress(scale: 0.2, targetScale: 0.3) == 1)
    #expect(OverviewMorph.pinchProgress(scale: 1.4, targetScale: 0.3) == 0)
  }

  @Test func onlyAPinchInStartsTheOverview() {
    #expect(OverviewMorph.pinchStartsOverview(scale: 0.9))
    #expect(!OverviewMorph.pinchStartsOverview(scale: 0.98))
    #expect(!OverviewMorph.pinchStartsOverview(scale: 1.3))
  }

  @Test func swipeProgressFollowsTheFinger() {
    #expect(OverviewMorph.swipeProgress(translation: 0) == 0)
    #expect(OverviewMorph.swipeProgress(translation: -160) == 0.5)
    #expect(OverviewMorph.swipeProgress(translation: 80) == 0)
    #expect(OverviewMorph.swipeProgress(translation: -900) == 1)
  }

  @Test func releaseCommitsByDistanceOrVelocity() {
    #expect(OverviewMorph.shouldCommit(progress: 0.5, velocity: 0))
    #expect(!OverviewMorph.shouldCommit(progress: 0.2, velocity: 0))
    #expect(OverviewMorph.shouldCommit(progress: 0.1, velocity: 1.5))
    #expect(!OverviewMorph.shouldCommit(progress: 0.6, velocity: -1.5))
  }

  @Test func pageIsHiddenForTheWholeMorph() {
    let morph = OverviewMorph()
    #expect(!morph.hidesPage)
    morph.start(.interactive, tabID: UUID(), image: nil, progress: 0)
    #expect(morph.hidesPage)
    morph.finish()
    #expect(!morph.hidesPage)
    #expect(morph.translation == .zero)
  }
}

struct WebViewInsetTests {
  @Test func statusStripIsNotReservedButNotchesAre() {
    let strip = OrbitWebView.sharedHorizontalInsets(UIEdgeInsets(top: 0, left: 0, bottom: 20, right: 86))
    #expect(strip == UIEdgeInsets(top: 0, left: 0, bottom: 20, right: 0))
    let notch = OrbitWebView.sharedHorizontalInsets(UIEdgeInsets(top: 0, left: 62, bottom: 21, right: 62))
    #expect(notch == UIEdgeInsets(top: 0, left: 62, bottom: 21, right: 62))
  }
}

struct MorphRecoveryTests {
  @Test func backgroundingSettlesEveryPhase() {
    #expect(OverviewMorph.settlement(for: .idle) == nil)
    #expect(OverviewMorph.settlement(for: .opening) == .showOverview)
    #expect(OverviewMorph.settlement(for: .interactive) == .showPage)
    #expect(OverviewMorph.settlement(for: .closing) == .showPage)
    #expect(OverviewMorph.settlement(for: .growing) == .showPage)
  }

  @Test func interruptedSwipeLeavesThePageVisible() {
    let browser = BrowserModel(
      persistence: TabPersistence(directory: FileManager.default.temporaryDirectory.appending(path: "OrbitTests-\(UUID().uuidString)")),
      settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
      syncClient: PreviewSync())
    browser.morph.start(.interactive, tabID: UUID(), image: nil, progress: 0.4)
    browser.isShowingTabSwitcher = true
    #expect(browser.morph.hidesPage)
    browser.scenePhaseChanged(.inactive)
    #expect(!browser.morph.hidesPage)
    #expect(!browser.isShowingTabSwitcher)
  }

  @Test func interruptedOpeningLandsInTheOverview() {
    let browser = BrowserModel(
      persistence: TabPersistence(directory: FileManager.default.temporaryDirectory.appending(path: "OrbitTests-\(UUID().uuidString)")),
      settings: AppSettings(defaults: UserDefaults(suiteName: "OrbitTests-\(UUID().uuidString)")!),
      syncClient: PreviewSync())
    browser.morph.start(.opening, tabID: UUID(), image: nil, progress: 0.2)
    browser.isShowingTabSwitcher = true
    browser.scenePhaseChanged(.background)
    #expect(!browser.morph.isActive)
    #expect(browser.isShowingTabSwitcher)
  }
}

struct SnapshotFitTests {
  @Test func snapshotsKeepTheirFullWidth() {
    let tall = SnapshotFit.size(image: CGSize(width: 400, height: 900), in: CGSize(width: 200, height: 270))
    #expect(tall.width == 200)
    #expect(tall.height == 450)
    let wideIntoLandscapeCard = SnapshotFit.size(image: CGSize(width: 692, height: 1180), in: CGSize(width: 692, height: 653))
    #expect(wideIntoLandscapeCard.width == 692)
  }

  @Test func veryWideSnapshotsFillTheHeightInstead() {
    let wide = SnapshotFit.size(image: CGSize(width: 1000, height: 300), in: CGSize(width: 200, height: 270))
    #expect(wide.height == 270)
  }

}

struct SiteIconLinkTests {
  @Test func touchIconsWinThenTheLargestIconAndSvgIsSkipped() {
    let html = """
      <head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="mask-icon" href="/mask.svg">
      <link rel='icon' type='image/svg+xml' href='/icon.svg'>
      <LINK REL="shortcut icon" HREF="https://cdn.example.com/fav.ico">
      <link href="/icon-192.png" rel="icon" sizes="192x192">
      <link rel="apple-touch-icon" href="apple.png">
      </head>
      """
    let base = URL(string: "https://www.example.com/")!
    #expect(SiteIconLinks.candidates(html: html, base: base).map(\.absoluteString) == [
      "https://www.example.com/apple.png",
      "https://www.example.com/icon-192.png",
      "https://cdn.example.com/fav.ico",
      "https://www.example.com/favicon-16.png",
    ])
  }

  @Test func onlyWebPagesHaveAnOrigin() {
    #expect(SiteIconLinks.origin(of: URL(string: "https://science.nasa.gov/solar-system/")) == URL(string: "https://science.nasa.gov/"))
    #expect(SiteIconLinks.origin(of: URL(string: "about:blank")) == nil)
    #expect(SiteIconLinks.origin(of: nil) == nil)
    #expect(DockSiteIcon.monogram(for: URL(string: "https://www.nasa.gov")) == "N")
  }
}
