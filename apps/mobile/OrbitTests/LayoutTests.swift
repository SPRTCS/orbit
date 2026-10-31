import Foundation
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
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 70, controlSize: 50, safeBottom: 34) == 45)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 18, controlSize: 46, safeBottom: 20) == 22)
    #expect(ChromeMetrics.edgeGap(displayCornerRadius: 0, controlSize: 50, safeBottom: 0) == 12)

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
