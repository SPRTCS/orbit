import Foundation
import SwiftUI
import Testing

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
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 0, controlSize: 50, safeBottom: 0) == 12)
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
