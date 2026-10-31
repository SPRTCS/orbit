import SwiftUI

struct AddressEntryOverlay: View {
  enum Layout {
    case compact
    case regular
  }

  let layout: Layout
  @Environment(BrowserModel.self) private var browser
  @FocusState private var fieldFocused: Bool

  private let rowHeight: CGFloat = 54

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .bottom) {
        Rectangle()
          .fill(.black.opacity(layout == .compact ? 0.32 : 0.18))
          .ignoresSafeArea()
          .onTapGesture { browser.cancelEntry() }
          .accessibilityHidden(true)
        panel(maxListHeight: max(rowHeight * 2, proxy.size.height - 120))
          .frame(maxWidth: layout == .regular ? 640 : .infinity)
          .padding(.horizontal, layout == .compact ? 10 : 16)
          .padding(.bottom, layout == .compact ? 8 : 12)
      }
    }
    .onAppear {
      fieldFocused = true
      browser.updateSuggestions()
    }
    .onChange(of: browser.entry.text) {
      browser.entry.highlightedIndex = nil
      browser.updateSuggestions()
    }
  }

  private func panel(maxListHeight: CGFloat) -> some View {
    let suggestions = browser.suggestions.suggestions
    return VStack(spacing: 6) {
      if !suggestions.isEmpty {
        ScrollView {
          VStack(spacing: 0) {
            ForEach(Array(suggestions.enumerated().reversed()), id: \.element.id) { index, suggestion in
              SuggestionRow(
                suggestion: suggestion, isHighlighted: browser.entry.highlightedIndex == index,
                choose: { browser.choose(suggestion) }, complete: { browser.complete(with: suggestion) }
              )
              .frame(height: rowHeight)
            }
          }
        }
        .defaultScrollAnchor(.bottom)
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.never)
        .frame(height: min(CGFloat(suggestions.count) * rowHeight, maxListHeight))
      }
      field
    }
    .padding(8)
    .glassEffect(.regular, in: .rect(cornerRadius: 30, style: .continuous))
  }

  private var field: some View {
    @Bindable var entry = browser.entry
    return HStack(spacing: 10) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(.secondary)
      TextField("Search or enter address", text: $entry.text, selection: $entry.selection)
        .font(.system(size: 17))
        .focused($fieldFocused)
        .keyboardType(.webSearch)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .textContentType(.URL)
        .submitLabel(.go)
        .onSubmit { browser.submitEntry() }
        .onKeyPress(.upArrow) { moveHighlight(1) }
        .onKeyPress(.downArrow) { moveHighlight(-1) }
        .onKeyPress(.escape) {
          browser.cancelEntry()
          return .handled
        }
      if !entry.text.isEmpty {
        Button {
          entry.text = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 17))
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear")
      }
      Button("Cancel") { browser.cancelEntry() }
        .font(.system(size: 16, weight: .medium))
        .buttonStyle(.plain)
        .foregroundStyle(Color.accentColor)
    }
    .padding(.horizontal, 16)
    .frame(height: 50)
    .background(.fill.tertiary, in: .capsule)
  }

  private func moveHighlight(_ delta: Int) -> KeyPress.Result {
    let count = browser.suggestions.suggestions.count
    guard count > 0 else { return .ignored }
    let current = browser.entry.highlightedIndex ?? -1
    let next = current + delta
    browser.entry.highlightedIndex = next < 0 ? nil : min(next, count - 1)
    return .handled
  }
}

struct SuggestionRow: View {
  let suggestion: Suggestion
  let isHighlighted: Bool
  let choose: () -> Void
  let complete: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      Group {
        if case .open(let url) = suggestion.action, suggestion.systemImage != "globe" {
          Favicon(url: url, size: 20)
        } else {
          Image(systemName: suggestion.systemImage)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(.secondary)
        }
      }
      .frame(width: 28, height: 28)
      VStack(alignment: .leading, spacing: 1) {
        Text(suggestion.title)
          .font(.system(size: 16, weight: .medium))
          .lineLimit(1)
        if let subtitle = suggestion.subtitle {
          Text(subtitle)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if let badge = suggestion.badge {
        Text(badge)
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 10)
          .padding(.vertical, 5)
          .background(.fill.secondary, in: .capsule)
      }
      if suggestion.completion != nil {
        Button(action: complete) {
          Image(systemName: "arrow.up.left")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(width: 36, height: 36)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Use \(suggestion.title)")
      }
    }
    .padding(.horizontal, 10)
    .frame(maxHeight: .infinity)
    .background(isHighlighted ? AnyShapeStyle(.fill.secondary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 16, style: .continuous))
    .contentShape(.rect)
    .onTapGesture(perform: choose)
    .hoverEffect(.highlight)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityAction(named: "Open", choose)
  }
}
