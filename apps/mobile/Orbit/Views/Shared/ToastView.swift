import SwiftUI

struct Toast: Identifiable {
  let id = UUID()
  let text: String
  let systemImage: String
  var actionTitle: String?
  var action: (() -> Void)?
}

struct ToastOverlay: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    if let toast = browser.toast {
      HStack(spacing: 10) {
        Image(systemName: toast.systemImage)
          .foregroundStyle(.secondary)
        Text(toast.text)
          .font(.subheadline.weight(.medium))
          .lineLimit(2)
        if let title = toast.actionTitle, let action = toast.action {
          Button(title) {
            action()
            browser.dismissToast()
          }
          .font(.subheadline.weight(.semibold))
          .buttonStyle(.plain)
          .foregroundStyle(Color.accentColor)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .glassEffect(.regular.interactive(), in: .capsule)
      .padding(.horizontal, 20)
      .id(toast.id)
      .transition(.move(edge: .bottom).combined(with: .opacity))
      .onTapGesture { browser.dismissToast() }
      .accessibilityAddTraits(.isStaticText)
    }
  }
}
