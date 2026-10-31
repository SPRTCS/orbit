import SwiftUI
import UIKit

struct KeyboardMetrics: Equatable {
  var overlap: CGFloat = 0
  var safeArea = EdgeInsets()
}

struct KeyboardMetricsReader: UIViewRepresentable {
  let onChange: (KeyboardMetrics) -> Void

  func makeUIView(context: Context) -> ReaderView {
    let view = ReaderView()
    view.isUserInteractionEnabled = false
    view.onChange = onChange
    return view
  }

  func updateUIView(_ view: ReaderView, context: Context) {
    view.onChange = onChange
    view.report()
  }

  final class ReaderView: UIView {
    var onChange: ((KeyboardMetrics) -> Void)?
    private var lastMetrics: KeyboardMetrics?
    private let tracker = UIView()

    override init(frame: CGRect) {
      super.init(frame: frame)
      keyboardLayoutGuide.followsUndockedKeyboard = true
      keyboardLayoutGuide.usesBottomSafeArea = false
      tracker.isUserInteractionEnabled = false
      tracker.translatesAutoresizingMaskIntoConstraints = false
      addSubview(tracker)
      NSLayoutConstraint.activate([
        tracker.leadingAnchor.constraint(equalTo: leadingAnchor),
        tracker.widthAnchor.constraint(equalToConstant: 1),
        tracker.topAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor),
        tracker.bottomAnchor.constraint(equalTo: keyboardLayoutGuide.bottomAnchor),
      ])
    }

    required init?(coder: NSCoder) {
      fatalError("init(coder:) is unavailable")
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      report()
    }

    override func safeAreaInsetsDidChange() {
      super.safeAreaInsetsDidChange()
      report()
    }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      report()
    }

    func report() {
      guard window != nil else { return }
      let keyboardFrame = keyboardLayoutGuide.layoutFrame
      let overlap = keyboardFrame.height > 1 ? max(0, bounds.maxY - keyboardFrame.minY) : 0
      let insets = safeAreaInsets
      let metrics = KeyboardMetrics(
        overlap: overlap.rounded(),
        safeArea: EdgeInsets(top: insets.top, leading: insets.left, bottom: insets.bottom, trailing: insets.right))
      guard metrics != lastMetrics else { return }
      lastMetrics = metrics
      let callback = onChange
      DispatchQueue.main.async { callback?(metrics) }
    }
  }
}
