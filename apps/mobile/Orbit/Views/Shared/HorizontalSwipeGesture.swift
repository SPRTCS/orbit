import SwiftUI
import UIKit

struct HorizontalSwipeGesture: UIGestureRecognizerRepresentable {
  var onChanged: (CGFloat) -> Void
  var onEnded: (_ translation: CGFloat, _ velocity: CGFloat) -> Void

  func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
    Coordinator()
  }

  func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
    let pan = UIPanGestureRecognizer()
    pan.delegate = context.coordinator
    pan.maximumNumberOfTouches = 1
    return pan
  }

  func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
    let translation = recognizer.translation(in: recognizer.view).x
    switch recognizer.state {
    case .changed:
      onChanged(translation)
    case .ended:
      onEnded(translation, recognizer.velocity(in: recognizer.view).x)
    case .cancelled, .failed:
      onEnded(0, 0)
    default:
      break
    }
  }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
      let velocity = pan.velocity(in: pan.view)
      return abs(velocity.x) > abs(velocity.y) * 1.3
    }
  }
}
