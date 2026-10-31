import SwiftUI

@Observable
final class AddressEntryModel {
  var isPresented = false
  var text = ""
  var selection: TextSelection?
  var opensInNewTab = false
  var highlightedIndex: Int?

  func begin(newTab: Bool, initialText: String) {
    opensInNewTab = newTab
    text = initialText
    selection = initialText.isEmpty ? nil : TextSelection(range: initialText.startIndex..<initialText.endIndex)
    highlightedIndex = nil
    isPresented = true
  }

  func dismiss() {
    isPresented = false
    text = ""
    selection = nil
    highlightedIndex = nil
  }
}
