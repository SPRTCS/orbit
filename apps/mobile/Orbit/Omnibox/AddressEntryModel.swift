import SwiftUI

@Observable
final class AddressEntryModel {
  var isPresented = false
  var text = ""
  var selection: TextSelection?
  var opensInNewTab = false
  var opensPrivateTab = false
  var highlightedIndex: Int?

  func begin(newTab: Bool, initialText: String, isPrivate: Bool = false) {
    opensInNewTab = newTab
    opensPrivateTab = newTab && isPrivate
    text = initialText
    selectAll()
    highlightedIndex = nil
    isPresented = true
  }

  func selectAll() {
    selection = text.isEmpty ? nil : TextSelection(range: text.startIndex..<text.endIndex)
  }

  func dismiss() {
    isPresented = false
    text = ""
    selection = nil
    highlightedIndex = nil
  }
}
