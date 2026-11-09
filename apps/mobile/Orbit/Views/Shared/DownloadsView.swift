import QuickLook
import SwiftUI

struct DownloadsView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.dismiss) private var dismiss
  @State private var preview: URL?
  @State private var isConfirmingClear = false

  var body: some View {
    let store = browser.downloads
    NavigationStack {
      List {
        if !store.active.isEmpty {
          Section("In Progress") {
            ForEach(store.active) { item in
              HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                  Text(item.filename).lineLimit(1)
                  ProgressView(value: item.fraction)
                }
                Button {
                  store.cancel(item)
                } label: {
                  Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel Download")
              }
            }
          }
        }
        Section {
          ForEach(store.files) { file in
            Button {
              preview = file.url
            } label: {
              HStack(spacing: 12) {
                Image(systemName: "doc")
                  .font(.title3)
                  .foregroundStyle(.secondary)
                  .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                  Text(file.name).lineLimit(1).foregroundStyle(.primary)
                  Text("\(file.size.formatted(.byteCount(style: .file))) · \(file.date.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
              }
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .swipeActions {
              Button("Delete", systemImage: "trash", role: .destructive) { store.delete(file) }
              ShareLink(item: file.url)
            }
            .contextMenu {
              ShareLink(item: file.url)
              Button("Delete", systemImage: "trash", role: .destructive) { store.delete(file) }
            }
          }
        } footer: {
          if !store.files.isEmpty {
            Text("Downloads are also in the Files app under On My \(UIDevice.current.localizedModel) › Orbit › Downloads.")
          }
        }
      }
      .overlay {
        if store.files.isEmpty, store.active.isEmpty {
          ContentUnavailableView(
            "No Downloads", systemImage: "arrow.down.circle",
            description: Text("Files you download appear here and in the Files app."))
        }
      }
      .navigationTitle("Downloads")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Clear") { isConfirmingClear = true }
            .disabled(store.files.isEmpty)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .confirmationDialog("Delete All Downloads?", isPresented: $isConfirmingClear, titleVisibility: .visible) {
        Button("Delete All", role: .destructive) { store.deleteAll() }
      }
      .quickLookPreview($preview)
      .onAppear { store.reload() }
    }
  }
}
