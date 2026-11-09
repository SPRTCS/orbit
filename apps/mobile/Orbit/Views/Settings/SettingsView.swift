import SwiftUI

struct SettingsView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.dismiss) private var dismiss
  @State private var confirmation: ClearAction?
  @State private var isDisconnectConfirmationShown = false
  @State private var deviceName = ""

  enum ClearAction: String, Identifiable {
    case history
    case websiteData
    case tabs

    var id: String { rawValue }

    var title: LocalizedStringResource {
      switch self {
      case .history: "Clear History?"
      case .websiteData: "Clear Cookies and Website Data?"
      case .tabs: "Close All Tabs?"
      }
    }

    var button: LocalizedStringResource {
      switch self {
      case .history: "Clear History"
      case .websiteData: "Clear Website Data"
      case .tabs: "Close All Tabs"
      }
    }
  }

  var body: some View {
    @Bindable var settings = browser.settings
    let sync = browser.sync
    NavigationStack {
      Form {
        Section {
          LabeledContent("Status", value: sync.statusText)
          if browser.canRenameDevice {
            LabeledContent("Device Name") {
              TextField("Device Name", text: $deviceName)
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { browser.renameDevice(deviceName) }
            }
          } else {
            LabeledContent("Device Name", value: sync.client.thisDeviceName)
          }
          if sync.isConnected {
            Button("Sync Now") { sync.refreshInBackground() }
            Button("Disconnect", role: .destructive) { isDisconnectConfirmationShown = true }
          } else {
            NavigationLink("Set Up Sync") { SyncSetupView() }
          }
        } header: {
          Text("Sync with Mac")
        } footer: {
          Text("Your open tabs show up in Orbit on your Mac under this device’s name, and your Mac’s spaces, pinned tabs and open tabs show up here. Everything is end-to-end encrypted with your recovery phrase.")
        }

        Section {
          Picker("Appearance", selection: Bindable(browser.themes).appearance) {
            ForEach(ThemeMode.allCases) { mode in Label(mode.title, systemImage: mode.symbol).tag(mode) }
          }
          Toggle("Accent Follows Space Theme", isOn: Binding(
            get: { browser.themes.accentOverride == nil },
            set: { follows in browser.themes.accentOverride = follows ? nil : Color.accentColor.themeColor }))
          if let accent = browser.themes.accentOverride {
            ColorPicker("Accent Colour", selection: Binding(
              get: { Color(theme: accent) }, set: { browser.themes.accentOverride = $0.themeColor }), supportsOpacity: false)
          }
          ForEach(themeTargets) { target in
            NavigationLink {
              ThemeEditorView(target: target)
            } label: {
              HStack {
                ThemePreview(theme: browser.themes.theme(for: target.space))
                  .frame(width: 44, height: 28)
                  .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text("\(target.title) Theme")
              }
            }
          }
          NavigationLink {
            AppIconPickerView()
          } label: {
            HStack {
              Image("IconPreview-\(currentIconID)")
                .resizable()
                .frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
              Text("App Icon")
            }
          }
        } header: {
          Text("Appearance")
        } footer: {
          Text("Themes start from your Mac's space colours. Changes stay on this device.")
        }

        Section("Search") {
          Picker("Search Engine", selection: $settings.searchEngine) {
            ForEach(SearchEngine.allCases) { engine in
              Text(engine.name).tag(engine)
            }
          }
          Toggle("Search Suggestions", isOn: $settings.searchSuggestionsEnabled)
        }

        Section {
          Toggle("Block Trackers and Ads", isOn: Binding(
            get: { browser.settings.contentBlockingEnabled }, set: { browser.setContentBlocking($0) }))
        } footer: {
          Text("Blocks requests to well-known advertising and tracking services on the sites you visit. Some ads may still appear.")
        }

        Section {
          Button("History") {
            dismiss()
            browser.isShowingHistory = true
          }
          Button("Downloads") {
            dismiss()
            browser.isShowingDownloads = true
          }
          Button("Clear History") { confirmation = .history }
          Button("Clear Cookies and Website Data") { confirmation = .websiteData }
          Button("Close All Tabs", role: .destructive) { confirmation = .tabs }
        } header: {
          Text("Privacy")
        } footer: {
          Text("History and tabs stay on this device. Search suggestions send what you type to your search engine.")
        }

        Section("About") {
          LabeledContent("Version", value: Self.versionString)
          Link(destination: URL(string: "https://github.com/SPRTCS/orbit/blob/orbit/apps/mobile/PRIVACY.md")!) {
            Label("Privacy Policy", systemImage: "hand.raised")
          }
          Link(destination: URL(string: "https://github.com/SPRTCS/orbit")!) {
            Label("Source Code", systemImage: "chevron.left.forwardslash.chevron.right")
          }
          NavigationLink {
            LicensesView()
          } label: {
            Label("Licenses", systemImage: "doc.text")
          }
        }
      }
      .navigationTitle("Settings")
      .onAppear { deviceName = sync.client.thisDeviceName }
      .onDisappear { browser.renameDevice(deviceName) }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .confirmationDialog(
        confirmation.map { Text($0.title) } ?? Text(verbatim: ""), isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
        titleVisibility: .visible, presenting: confirmation
      ) { action in
        Button(action.button, role: .destructive) { perform(action) }
      }
      .confirmationDialog("Disconnect Sync?", isPresented: $isDisconnectConfirmationShown, titleVisibility: .visible) {
        Button("Disconnect", role: .destructive) { sync.client.disconnect() }
      } message: {
        Text("This iPhone stops syncing. Your Mac keeps its data, and you can connect again with your recovery phrase.")
      }
    }
  }

  private func perform(_ action: ClearAction) {
    switch action {
    case .history: browser.clearHistory()
    case .websiteData: Task { await browser.clearWebsiteData() }
    case .tabs: browser.closeAllTabs()
    }
  }

  private var themeTargets: [ThemeEditTarget] {
    let spaces = browser.sync.client.spaces
    return spaces.isEmpty ? [ThemeEditTarget(space: nil)] : spaces.map { ThemeEditTarget(space: $0) }
  }

  private var currentIconID: String {
    UIApplication.shared.alternateIconName.map { $0.replacingOccurrences(of: "AppIcon-", with: "").lowercased() } ?? "default"
  }

  static var versionString: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    let build = info?["CFBundleVersion"] as? String ?? "0"
    return "\(version) (\(build))"
  }
}

struct LicensesView: View {
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Text("Orbit for iPhone and iPad is open source under the MIT License. Orbit for Mac is a fork of Ardia and is licensed under the Apache License 2.0.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        Text("MIT License")
          .font(.headline)
        Text(Self.mitLicense)
          .font(.system(.footnote, design: .monospaced))
          .textSelection(.enabled)
        Text("Readability.js")
          .font(.headline)
        Text("The reader uses Readability.js. Copyright (c) 2010 Arc90 Inc and Mozilla contributors. Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0")
          .font(.footnote)
          .textSelection(.enabled)
      }
      .padding(20)
    }
    .navigationTitle("Licenses")
    .navigationBarTitleDisplayMode(.inline)
  }

  static let mitLicense = """
    Copyright (c) 2026 AIS Consulting UG and Orbit contributors

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
    """
}
