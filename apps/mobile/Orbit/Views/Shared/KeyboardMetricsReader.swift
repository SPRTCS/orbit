import SwiftUI
import UIKit

struct KeyboardMetrics: Equatable {
  var overlap: CGFloat = 0
  var safeArea = EdgeInsets()

  static func overlap(viewBounds: CGRect, keyboardFrame: CGRect) -> CGFloat {
    guard keyboardFrame.height > 1, keyboardFrame.minY < viewBounds.maxY else { return 0 }
    return max(0, viewBounds.maxY - keyboardFrame.minY).rounded()
  }

  static func entryBottomPadding(overlap: CGFloat, safeBottom: CGFloat, margin: CGFloat) -> CGFloat {
    max(overlap, safeBottom) + margin
  }
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
      let overlap = KeyboardMetrics.overlap(viewBounds: bounds, keyboardFrame: keyboardLayoutGuide.layoutFrame)
      let insets = safeAreaInsets
      let metrics = KeyboardMetrics(
        overlap: overlap,
        safeArea: EdgeInsets(top: insets.top, leading: insets.left, bottom: insets.bottom, trailing: insets.right))
      guard metrics != lastMetrics else { return }
      lastMetrics = metrics
      let callback = onChange
      DispatchQueue.main.async { callback?(metrics) }
    }
  }
}
