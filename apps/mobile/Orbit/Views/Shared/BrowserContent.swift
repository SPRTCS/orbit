import SwiftUI

struct BrowserContent: View {
  @Environment(BrowserModel.self) private var browser
  var bottomObscured: CGFloat
  var ignoresSafeArea = false
  var obscuredSides = ObscuredSides()

  var body: some View {
    if let tab = browser.selectedTab, !tab.isBlank {
      WebViewContainer(
        browser: browser, tab: tab, bottomObscured: bottomObscured, ignoresSafeArea: ignoresSafeArea,
        obscuredSides: obscuredSides)
        .overlay {
          if let error = tab.loadError {
            LoadErrorView(message: error, url: tab.failedURL ?? tab.url) { browser.reload() }
          }
        }
    } else {
      StartPageView()
    }
  }
}

struct LoadErrorView: View {
  let message: String
  let url: URL?
  let retry: () -> Void

  var body: some View {
    ZStack {
      Rectangle().fill(.background)
      VStack(spacing: 14) {
        Image(systemName: "wifi.exclamationmark")
          .font(.system(size: 40, weight: .medium))
          .foregroundStyle(.secondary)
        Text("Can’t open this page")
          .font(.title3.weight(.semibold))
        if let url {
          Text(Omnibox.displayHost(url))
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
        }
        Text(message)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        Button("Try Again", action: retry)
          .buttonStyle(.glassProminent)
          .padding(.top, 4)
      }
      .padding(32)
      .frame(maxWidth: 420)
    }
  }
}

struct StartPageView: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let devices = browser.sync.recentDevices
    ZStack {
      OrbitBackdrop()
      ScrollView {
        VStack(spacing: 28) {
          OrbitMark(size: 54)
            .shadow(color: .black.opacity(0.2), radius: 16, y: 8)
            .padding(.top, 70)
          if let device = devices.first {
            VStack(alignment: .leading, spacing: 10) {
              Label("Continue from \(device.name)", systemImage: device.systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
              VStack(spacing: 0) {
                ForEach(Array(device.tabs.prefix(5).enumerated()), id: \.offset) { _, tab in
                  Button {
                    browser.openSynced(tab.url)
                  } label: {
                    HStack(spacing: 12) {
                      Favicon(url: tab.url, size: 20)
                      VStack(alignment: .leading, spacing: 2) {
                        Text(tab.title).font(.body.weight(.medium)).lineLimit(1)
                        Text(Omnibox.displayHost(tab.url)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                      }
                      Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(.rect)
                  }
                  .buttonStyle(.plain)
                  .hoverEffect(.highlight)
                }
              }
              .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
            }
            .frame(maxWidth: 520)
            .padding(.horizontal, 18)
          }
          FrequentSitesGrid()
          if devices.first == nil, !browser.sync.isConnected {
            Button {
              browser.isShowingSyncSetup = true
            } label: {
              Label("Sync tabs with Orbit on your Mac", systemImage: "laptopcomputer.and.iphone")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 6)
            }
            .buttonStyle(.glass)
          }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 120)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
  }
}

struct FrequentSitesGrid: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let _ = browser.history.revision
    let sites = browser.history.frequent(limit: 8)
    if !sites.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        Text("Frequently Visited")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.secondary)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 78, maximum: 110), spacing: 12, alignment: .top)], spacing: 16) {
          ForEach(sites) { entry in
            Button {
              browser.open(entry.url, inNewTab: false)
            } label: {
              VStack(spacing: 7) {
                Favicon(url: entry.url, size: 30)
                  .frame(width: 58, height: 58)
                  .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16, style: .continuous))
                Text(Omnibox.displayHost(entry.url))
                  .font(.caption)
                  .lineLimit(1)
              }
              .frame(maxWidth: .infinity)
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .hoverEffect(.lift)
            .contextMenu {
              Button("Open in New Tab", systemImage: "plus.square.on.square") { browser.open(entry.url, inNewTab: true) }
              Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = entry.url }
              Button("Remove from History", systemImage: "trash", role: .destructive) {
                browser.history.remove(entry.url)
              }
            }
            .accessibilityLabel(entry.title.isEmpty ? Omnibox.displayHost(entry.url) : entry.title)
          }
        }
      }
      .frame(maxWidth: 520)
      .padding(.horizontal, 18)
    }
  }
}
