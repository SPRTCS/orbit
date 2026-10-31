import SwiftUI

struct TabSwitcherView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  var body: some View {
    ZStack(alignment: .bottom) {
      OrbitBackdrop(tint: browser.currentSpace?.tint)
        .ignoresSafeArea()
      if browser.tabs.isEmpty {
        emptyState
      } else {
        grid
      }
      SwitcherBottomBar()
        .padding(.horizontal, 14)
        .padding(.bottom, 4)
    }
  }

  private var grid: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: horizontalSizeClass == .regular ? 200 : 150, maximum: 260), spacing: 16)],
          spacing: 20
        ) {
          ForEach(browser.tabs) { tab in
            TabCard(tab: tab, isSelected: tab.id == browser.selectedTabID)
              .id(tab.id)
          }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 110)
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

struct SwitcherBottomBar: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    GlassEffectContainer(spacing: 10) {
      HStack(spacing: 10) {
        GlassCircleButton(systemImage: "laptopcomputer.and.iphone", label: "Devices and Spaces") {
          browser.isShowingDevices = true
        }
        GlassCircleButton(systemImage: "gearshape", label: "Settings") {
          browser.isShowingSettings = true
        }
        Spacer(minLength: 0)
        if browser.selectedTab != nil {
          Button {
            browser.hideTabSwitcher()
          } label: {
            Text("Done")
              .font(.system(size: 16, weight: .semibold))
              .padding(.horizontal, 22)
              .frame(height: 50)
              .contentShape(.capsule)
          }
          .buttonStyle(.plain)
          .glassEffect(.regular.interactive(), in: .capsule)
          .keyboardShortcut(.cancelAction)
        }
        Spacer(minLength: 0)
        GlassCircleButton(systemImage: "plus", label: "New Tab") {
          browser.beginNewTab()
        }
      }
    }
  }
}

struct TabCard: View {
  @Environment(BrowserModel.self) private var browser
  let tab: BrowserTab
  let isSelected: Bool
  @State private var dragOffset: CGFloat = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Favicon(url: tab.url, size: 16)
        Text(tab.displayTitle)
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
      }
      .padding(.horizontal, 4)
      Color.clear
        .aspectRatio(0.74, contentMode: .fit)
        .overlay {
          if let snapshot = tab.snapshot {
            Image(uiImage: snapshot)
              .resizable()
              .scaledToFill()
              .frame(maxHeight: .infinity, alignment: .top)
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
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 22, style: .continuous)
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
    }
    .contentShape(.rect)
    .offset(x: dragOffset)
    .opacity(1 - min(abs(dragOffset) / 260, 0.7))
    .onTapGesture { browser.select(tab) }
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
