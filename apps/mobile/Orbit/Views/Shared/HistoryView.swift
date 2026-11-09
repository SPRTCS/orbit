import SwiftUI

struct HistoryDay: Identifiable, Equatable {
  let day: Date
  let entries: [HistoryEntry]

  var id: Date { day }

  func title(calendar: Calendar = .current) -> String {
    if calendar.isDateInToday(day) { return String(localized: "Today") }
    if calendar.isDateInYesterday(day) { return String(localized: "Yesterday") }
    return day.formatted(date: .complete, time: .omitted)
  }

  static func grouped(_ entries: [HistoryEntry], calendar: Calendar = .current) -> [HistoryDay] {
    var order: [Date] = []
    var buckets: [Date: [HistoryEntry]] = [:]
    for entry in entries.sorted(by: { $0.lastVisit > $1.lastVisit }) {
      let day = calendar.startOfDay(for: entry.lastVisit)
      if buckets[day] == nil { order.append(day) }
      buckets[day, default: []].append(entry)
    }
    return order.map { HistoryDay(day: $0, entries: buckets[$0] ?? []) }
  }
}

struct HistoryView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var isConfirmingClear = false

  var body: some View {
    let history = browser.history
    let _ = history.revision
    let entries = query.isEmpty ? history.all() : history.matches(query, limit: 200)
    NavigationStack {
      List {
        if query.isEmpty, !browser.recentlyClosed.isEmpty {
          Section("Recently Closed") {
            ForEach(browser.recentlyClosed.reversed().prefix(8)) { record in
              if let url = record.url {
                HistoryRow(title: record.title, url: url) {
                  browser.reopenClosedTab(record.id)
                  dismiss()
                }
              }
            }
          }
        }
        ForEach(HistoryDay.grouped(entries)) { day in
          Section(day.title()) {
            ForEach(day.entries) { entry in
              HistoryRow(title: entry.title, url: entry.url) {
                browser.open(entry.url, inNewTab: browser.selectedTab == nil)
                dismiss()
              }
              .swipeActions {
                Button("Delete", systemImage: "trash", role: .destructive) { history.remove(entry.url) }
              }
              .contextMenu {
                Button("Open in New Tab", systemImage: "plus.square.on.square") {
                  browser.open(entry.url, inNewTab: true)
                  dismiss()
                }
                Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = entry.url }
                Button("Delete", systemImage: "trash", role: .destructive) { history.remove(entry.url) }
              }
            }
          }
        }
      }
      .overlay {
        if entries.isEmpty {
          if query.isEmpty {
            ContentUnavailableView(
              "No History", systemImage: "clock", description: Text("Pages you visit appear here. Private tabs are never recorded."))
          } else {
            ContentUnavailableView.search(text: query)
          }
        }
      }
      .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search History")
      .navigationTitle("History")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Clear") { isConfirmingClear = true }
            .disabled(history.count == 0)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .confirmationDialog("Clear History?", isPresented: $isConfirmingClear, titleVisibility: .visible) {
        Button("Clear History", role: .destructive) { browser.clearHistory() }
      }
    }
  }
}

struct HistoryRow: View {
  let title: String
  let url: URL
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Favicon(url: url, size: 20)
          .frame(width: 28)
        VStack(alignment: .leading, spacing: 2) {
          Text(title.isEmpty ? Omnibox.displayHost(url) : title)
            .lineLimit(1)
            .foregroundStyle(.primary)
          Text(Omnibox.displayHost(url))
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
  }
}
