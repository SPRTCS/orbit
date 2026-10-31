import OrbitSync
import SwiftUI
import VisionKit

struct SyncSetupView: View {
  @Environment(BrowserModel.self) private var browser
  @State private var isPickingFolder = false
  @State private var isScanning = false
  @State private var phrase = ""
  @State private var folderName: String?
  @State private var errorMessage: String?
  @State private var isWorking = false

  private var scannerAvailable: Bool {
    DataScannerViewController.isSupported && DataScannerViewController.isAvailable
  }

  var body: some View {
    let sync = browser.sync
    let state = sync.client.state
    let wordCount = RecoveryPhrase.words(in: phrase).count
    Form {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Image(systemName: "laptopcomputer.and.iphone")
            .font(.system(size: 34))
            .foregroundStyle(Color.accentColor)
          Text("Sync with Orbit on your Mac")
            .font(.title3.weight(.semibold))
          Text("See your Mac’s spaces, pinned tabs and open tabs here, and this device’s tabs on your Mac. Sync runs through a folder in your iCloud Drive and is end-to-end encrypted.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
      }

      Section {
        Button {
          isPickingFolder = true
        } label: {
          Label(folderName.map { "Folder: \($0)" } ?? "Choose Sync Folder…", systemImage: "folder")
        }
        .disabled(isWorking)
      } header: {
        Text("1 · Sync folder")
      } footer: {
        Text("In iCloud Drive, pick the “Orbit Sync” folder (or “Ardia Sync”) that Orbit on your Mac syncs to. On the Mac it’s in Settings › Sync.")
      }

      if state != .notSetUp {
        Section {
          TextField("24-word recovery phrase", text: $phrase, axis: .vertical)
            .lineLimit(3...6)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .privacySensitive()
            .font(.system(.body, design: .monospaced))
          HStack {
            PasteButton(payloadType: String.self) { strings in
              if let text = strings.first { phrase = RecoveryPhrase.normalized(text) }
            }
            .buttonBorderShape(.capsule)
            .labelStyle(.titleAndIcon)
            if scannerAvailable {
              Button("Scan QR Code", systemImage: "qrcode.viewfinder") { isScanning = true }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }
            Spacer(minLength: 0)
            Text("\(wordCount)/\(RecoveryPhrase.expectedWordCount)")
              .font(.caption.monospacedDigit())
              .foregroundStyle(wordCount == RecoveryPhrase.expectedWordCount ? Color.green : Color.secondary)
          }
          Button {
            submitPhrase()
          } label: {
            HStack {
              Text(sync.isConnected ? "Update Phrase" : "Connect")
              if isWorking { Spacer(); ProgressView() }
            }
          }
          .disabled(wordCount != RecoveryPhrase.expectedWordCount || isWorking)
        } header: {
          Text("2 · Recovery phrase")
        } footer: {
          Text("Find it in your Orbit Recovery Kit, or on your Mac in Settings › Sync. Scanning the Recovery Kit’s QR code fills it in for you.")
        }
      }

      if sync.isConnected {
        Section {
          Label("Connected as \(sync.client.thisDeviceName)", systemImage: "checkmark.circle.fill")
            .foregroundStyle(.green)
          Text(sync.statusText).foregroundStyle(.secondary)
        }
      }

      if let errorMessage {
        Section {
          Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.red)
        }
      }
    }
    .navigationTitle("Sync with Mac")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $isPickingFolder) {
      FolderPicker { url in connect(url) }
        .ignoresSafeArea()
    }
    .sheet(isPresented: $isScanning) {
      NavigationStack {
        RecoveryKitScanner { payload in
          phrase = RecoveryPhrase.normalized(payload)
          isScanning = false
        }
        .ignoresSafeArea()
        .navigationTitle("Scan Recovery Kit")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { isScanning = false }
          }
        }
      }
    }
  }

  private func connect(_ url: URL) {
    errorMessage = nil
    do {
      try browser.sync.client.connect(folder: url)
      folderName = url.lastPathComponent
    } catch {
      errorMessage = Self.describe(error)
    }
  }

  private func submitPhrase() {
    errorMessage = nil
    isWorking = true
    let normalized = RecoveryPhrase.normalized(phrase)
    Task {
      defer { isWorking = false }
      do {
        try await browser.sync.client.enterRecoveryPhrase(normalized)
        phrase = ""
        browser.sync.didConnect()
      } catch {
        errorMessage = Self.describe(error)
      }
    }
  }

  static func describe(_ error: any Error) -> String {
    guard let syncError = error as? OrbitSyncError else { return error.localizedDescription }
    switch syncError {
    case .folderUnreadable(let detail): return "Orbit can’t read that folder. \(detail)"
    case .invalidPhrase(let detail): return "That recovery phrase isn’t valid. \(detail)"
    case .phraseDoesNotMatchFolder: return "That recovery phrase belongs to a different sync folder."
    case .notConnected: return "Choose the sync folder first."
    }
  }
}

struct SyncSetupSheet: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      SyncSetupView()
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }
          }
        }
    }
  }
}

struct FolderPicker: UIViewControllerRepresentable {
  let onPick: (URL) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onPick: onPick)
  }

  func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
    picker.allowsMultipleSelection = false
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

  final class Coordinator: NSObject, UIDocumentPickerDelegate {
    let onPick: (URL) -> Void

    init(onPick: @escaping (URL) -> Void) {
      self.onPick = onPick
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
      if let url = urls.first { onPick(url) }
    }
  }
}

struct RecoveryKitScanner: UIViewControllerRepresentable {
  let onPayload: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onPayload: onPayload)
  }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true, isGuidanceEnabled: true,
      isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    if !scanner.isScanning { try? scanner.startScanning() }
  }

  static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
    scanner.stopScanning()
  }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let onPayload: (String) -> Void
    private var delivered = false

    init(onPayload: @escaping (String) -> Void) {
      self.onPayload = onPayload
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
      for item in addedItems {
        guard !delivered, case .barcode(let barcode) = item, let payload = barcode.payloadStringValue else { continue }
        delivered = true
        dataScanner.stopScanning()
        onPayload(payload)
      }
    }
  }
}
