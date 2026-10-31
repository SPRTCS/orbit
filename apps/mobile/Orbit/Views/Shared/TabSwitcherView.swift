import SwiftUI

struct TabSwitcherView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  var windowSafeArea: EdgeInsets?

  var body: some View {
    GeometryReader { proxy in
      let safeArea = windowSafeArea ?? proxy.safeAreaInsets
      let isRegular = horizontalSizeClass == .regular
      let buttonSize: CGFloat = isRegular ? ChromeMetrics.regularControlSize : 50
      let gap = ChromeMetrics.edgeGap(
        displayCornerRadius: browser.morph.displayCornerRadius, controlSize: buttonSize, safeBottom: safeArea.bottom)
      let horizontalGap = ChromeMetrics.horizontalInset(
        edgeGap: gap, safeLeading: safeArea.leading, safeTrailing: safeArea.trailing)
      let barWidth = proxy.size.width + safeArea.leading + safeArea.trailing - 2 * horizontalGap
      ZStack(alignment: .bottom) {
        OrbitBackdrop()
        if browser.tabs.isEmpty {
          emptyState
        } else {
          grid(safeArea: safeArea, isRegular: isRegular, bottomInset: gap + buttonSize + 20)
        }
        SwitcherBottomBar(
          buttonSize: buttonSize,
          centersDone: OverviewBarLayout.centersDone(barWidth: barWidth, buttonSize: buttonSize))
          .padding(.horizontal, horizontalGap)
          .padding(.bottom, gap)
      }
      .ignoresSafeArea(.container)
    }
    .opacity(browser.morph.overviewOpacity)
  }

  private func grid(safeArea: EdgeInsets, isRegular: Bool, bottomInset: CGFloat) -> some View {
    let cardAspect = isRegular ? min(max(browser.morph.pageAspectRatio, 0.75), 1.6) : 0.74
    let columns = [
      GridItem(.adaptive(minimum: isRegular ? 250 : 150, maximum: isRegular ? 380 : 260), spacing: isRegular ? 22 : 16)
    ]
    return ScrollViewReader { proxy in
      ScrollView {
        LazyVGrid(columns: columns, spacing: isRegular ? 26 : 20) {
          ForEach(browser.tabs) { tab in
            TabCard(tab: tab, isSelected: tab.id == browser.selectedTabID, aspectRatio: cardAspect)
              .id(tab.id)
          }
        }
        .padding(.horizontal, max(16, min(safeArea.leading, safeArea.trailing) + 8))
        .padding(.top, safeArea.top + 16)
        .padding(.bottom, bottomInset)
      }
      .onAppear {
        if let id = browser.selectedTabID { proxy.scrollTo(id, anchor: .center) }
      }
    }
  }

  private var emptyState: some View {
    VStack(spacing: 14) {
      OrbitMark(size: 46)
      Text("No open tabs")
        .font(.title3.weight(.semibold))
      Text("Tap + to search or open a website.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

enum OverviewBarLayout {
  static let spacing: CGFloat = 12
  static let doneWidth: CGFloat = 86
  static let clearance: CGFloat = 12

  static func centersDone(barWidth: CGFloat, buttonSize: CGFloat) -> Bool {
    let leadingGroup = 2 * buttonSize + spacing
    return leadingGroup + clearance <= (barWidth - doneWidth) / 2
  }
}

struct SwitcherBottomBar: View {
  @Environment(BrowserModel.self) private var browser
  var buttonSize: CGFloat = 50
  var centersDone = true

  var body: some View {
    GlassEffectContainer(spacing: 4) {
      if centersDone {
        ZStack {
          HStack(spacing: OverviewBarLayout.spacing) {
            devicesButton
            settingsButton
            Spacer(minLength: 0)
            plusButton
          }
          doneButton
        }
      } else {
        HStack(spacing: OverviewBarLayout.spacing) {
          devicesButton
          settingsButton
          Spacer(minLength: OverviewBarLayout.clearance)
          doneButton
          Spacer(minLength: OverviewBarLayout.clearance)
          plusButton
        }
      }
    }
  }

  private var devicesButton: some View {
    GlassCircleButton(systemImage: "laptopcomputer.and.iphone", label: "Devices and Spaces", size: buttonSize) {
      browser.isShowingDevices = true
    }
  }

  private var settingsButton: some View {
    GlassCircleButton(systemImage: "gearshape", label: "Settings", size: buttonSize) {
      browser.isShowingSettings = true
    }
  }

  private var plusButton: some View {
    GlassCircleButton(systemImage: "plus", label: "New Tab", size: buttonSize) {
      browser.beginNewTab()
    }
    .reportsGlobalFrame { browser.morph.plusFrame = $0 }
  }

  @ViewBuilder
  private var doneButton: some View {
    if browser.selectedTab != nil {
      Button {
        browser.hideTabSwitcher()
      } label: {
        Text("Done")
          .font(.system(size: 16, weight: .semibold))
          .frame(width: OverviewBarLayout.doneWidth, height: buttonSize)
          .contentShape(.capsule)
      }
      .buttonStyle(.plain)
      .glassEffect(.regular.interactive(), in: .capsule)
      .hoverEffect(.lift)
      .keyboardShortcut(.cancelAction)
    }
  }
}

struct TabCard: View {
  @Environment(BrowserModel.self) private var browser
  let tab: BrowserTab
  let isSelected: Bool
  var aspectRatio: CGFloat = 0.74
  @State private var dragOffset: CGFloat = 0

  private var isMorphTarget: Bool {
    browser.morph.isActive && browser.morph.tabID == tab.id
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Favicon(url: tab.url, size: 16)
        Text(tab.displayTitle)
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
      }
      .padding(.horizontal, 4)
      .opacity(isMorphTarget ? Double(max(0, browser.morph.cardReveal - 0.6) / 0.4) : 1)
      Color.clear
        .aspectRatio(aspectRatio, contentMode: .fit)
        .overlay {
          if let snapshot = tab.snapshot {
            TopAlignedSnapshot(image: snapshot)
          } else {
            ZStack {
              Rectangle().fill(.background.secondary)
              VStack(spacing: 8) {
                Favicon(url: tab.url, size: 34)
                Text(tab.host ?? "New Tab")
                  .font(.caption.weight(.medium))
                  .foregroundStyle(.secondary)
              }
            }
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: OverviewMorph.cardCornerRadius, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: OverviewMorph.cardCornerRadius, style: .continuous)
            .strokeBorder(isSelected ? Color.accentColor : Color.white.opacity(0.12), lineWidth: isSelected ? 3 : 1)
        }
        .overlay(alignment: .topTrailing) {
          Button {
            withAnimation(.snappy) { browser.close(tab) }
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 12, weight: .bold))
              .frame(width: 28, height: 28)
              .contentShape(.circle)
          }
          .buttonStyle(.plain)
          .glassEffect(.regular.interactive(), in: .circle)
          .padding(8)
          .accessibilityLabel("Close \(tab.displayTitle)")
        }
        .shadow(color: .black.opacity(0.28), radius: 12, y: 6)
        .reportsGlobalFrame { browser.morph.cardFrames[tab.id] = $0 }
        .opacity(browser.morph.hidesCard(of: tab.id) ? 0 : 1)
    }
    .contentShape(.rect)
    .opacity(isMorphTarget ? 1 : Double(browser.morph.cardReveal))
    .scaleEffect(isMorphTarget ? 1 : 0.9 + 0.1 * browser.morph.cardReveal)
    .animation(
      browser.morph.phase == .interactive
        ? nil : OverviewMorph.animation.delay(browser.morph.revealDelay(for: tab.id)),
      value: browser.morph.cardReveal
    )
    .offset(x: dragOffset)
    .opacity(1 - min(abs(dragOffset) / 260, 0.7))
    .onTapGesture { browser.openFromOverview(tab) }
    .gesture(
      HorizontalSwipeGesture(
        onChanged: { translation in dragOffset = min(translation, 40) },
        onEnded: { translation, velocity in
          if translation + velocity * 0.2 < -110 {
            withAnimation(.snappy(duration: 0.22)) { dragOffset = -500 }
            Task {
              try? await Task.sleep(for: .milliseconds(180))
              withAnimation(.snappy) { browser.close(tab) }
            }
          } else {
            withAnimation(.spring(duration: 0.3)) { dragOffset = 0 }
          }
        })
    )
    .contextMenu {
      if let url = tab.url {
        Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = url }
        Button("Share", systemImage: "square.and.arrow.up") { UIKitPresenter.share(url, title: tab.title) }
      }
      Button("Close Tab", systemImage: "xmark", role: .destructive) { browser.close(tab) }
    }
    .hoverEffect(.lift)
    .onAppear { browser.loadSnapshotIfNeeded(tab) }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(tab.displayTitle)
    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    .accessibilityAction(named: "Close") { browser.close(tab) }
  }
}
