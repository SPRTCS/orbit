import SwiftUI
import UIKit

@Observable
final class OverviewMorph {
  enum Phase: Equatable {
    case idle
    case opening
    case closing
    case interactive
    case growing
  }

  static let animation: Animation = .spring(duration: 0.45, bounce: 0)
  static let cardCornerRadius: CGFloat = 22
  static let maximumStagger: Double = 0.12

  var phase: Phase = .idle
  var tabID: UUID?
  var image: UIImage?
  var progress: CGFloat = 0
  var sourceFrame: CGRect?
  var cardReveal: CGFloat = 1
  var cardFrames: [UUID: CGRect] = [:]
  var displayCornerRadius: CGFloat = 0
  @ObservationIgnored var plusFrame: CGRect?
  @ObservationIgnored var pageFrame: CGRect?
  @ObservationIgnored var pageCornerRadius: CGFloat = 0

  var pageAspectRatio: CGFloat {
    guard let pageFrame, pageFrame.height > 0 else { return 4 / 3 }
    return pageFrame.width / pageFrame.height
  }

  func revealDelay(for id: UUID) -> Double {
    guard isActive, phase != .interactive, id != tabID, let card = cardFrames[id], let target = targetFrame else { return 0 }
    let distance = hypot(card.midX - target.midX, card.midY - target.midY)
    let reach = max(hypot(pageFrame?.width ?? 1000, pageFrame?.height ?? 1000), 1)
    let fraction = min(Double(distance / reach), 1)
    return phase == .closing ? (1 - fraction) * Self.maximumStagger * 0.5 : fraction * Self.maximumStagger
  }

  var isActive: Bool { phase != .idle }

  var targetFrame: CGRect? {
    if phase == .growing { return sourceFrame }
    guard let tabID else { return nil }
    return cardFrames[tabID]
  }

  func hidesCard(of id: UUID) -> Bool {
    isActive && phase != .growing && tabID == id
  }

  var overviewOpacity: Double {
    switch phase {
    case .idle, .growing: 1
    case .opening, .closing, .interactive: Double(progress)
    }
  }

  func start(_ phase: Phase, tabID: UUID?, image: UIImage?, progress: CGFloat, sourceFrame: CGRect? = nil) {
    self.phase = phase
    self.tabID = tabID
    self.image = image
    self.progress = progress
    self.sourceFrame = sourceFrame
    if phase != .growing { cardReveal = progress }
  }

  func finish() {
    phase = .idle
    tabID = nil
    image = nil
    sourceFrame = nil
    cardReveal = 1
  }
}

struct OverviewMorphLayer: View {
  @Environment(BrowserModel.self) private var browser

  var body: some View {
    let morph = browser.morph
    if morph.isActive {
      GeometryReader { proxy in
        let origin = proxy.frame(in: .global).origin
        let full = CGRect(origin: .zero, size: proxy.size)
        let page = morph.pageFrame.map { $0.offsetBy(dx: -origin.x, dy: -origin.y) } ?? full
        let target = morph.targetFrame.map { $0.offsetBy(dx: -origin.x, dy: -origin.y) } ?? page
        MorphSnapshot(image: morph.image)
          .modifier(
            MorphGeometry(
              progress: morph.progress, from: page, to: target, fromRadius: morph.pageCornerRadius,
              toRadius: morph.phase == .growing ? target.height / 2 : OverviewMorph.cardCornerRadius))
      }
      .ignoresSafeArea()
      .allowsHitTesting(false)
      .transition(.opacity)
    }
  }
}

struct MorphSnapshot: View {
  let image: UIImage?

  var body: some View {
    ZStack {
      Rectangle().fill(Color(uiColor: .systemBackground))
      TopAlignedSnapshot(image: image)
    }
  }
}

struct TopAlignedSnapshot: View {
  let image: UIImage?

  var body: some View {
    GeometryReader { proxy in
      if let image, image.size.width > 0, image.size.height > 0 {
        let scale = max(proxy.size.width / image.size.width, proxy.size.height / image.size.height)
        Image(uiImage: image)
          .resizable()
          .frame(width: image.size.width * scale, height: image.size.height * scale)
          .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
      }
    }
    .clipped()
  }
}

struct MorphGeometry: ViewModifier, Animatable {
  var progress: CGFloat
  let from: CGRect
  let to: CGRect
  let fromRadius: CGFloat
  let toRadius: CGFloat

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    let t = min(max(progress, 0), 1)
    let rect = CGRect(
      x: from.minX + (to.minX - from.minX) * t, y: from.minY + (to.minY - from.minY) * t,
      width: from.width + (to.width - from.width) * t, height: from.height + (to.height - from.height) * t)
    let radius = fromRadius + (toRadius - fromRadius) * t
    content
      .frame(width: max(rect.width, 1), height: max(rect.height, 1))
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .shadow(color: .black.opacity(0.3 * Double(t)), radius: 12, y: 6)
      .position(x: rect.midX, y: rect.midY)
  }
}

struct VerticalSwipeGesture: UIGestureRecognizerRepresentable {
  var onBegan: () -> Bool
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
    let translation = recognizer.translation(in: recognizer.view?.window).y
    switch recognizer.state {
    case .began:
      if !onBegan() {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
      }
    case .changed:
      onChanged(translation)
    case .ended:
      onEnded(translation, recognizer.velocity(in: recognizer.view?.window).y)
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
      return velocity.y < 0 && abs(velocity.y) > abs(velocity.x) * 1.3
    }
  }
}

extension View {
  func reportsGlobalFrame(_ update: @escaping (CGRect) -> Void) -> some View {
    onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { update($0) }
  }
}

struct DisplayCornerReader: View {
  let onChange: (CGFloat) -> Void

  var body: some View {
    GeometryReader { proxy in
      let radius = Self.displayCornerRadius(proxy)
      Color.clear
        .onAppear { onChange(radius) }
        .onChange(of: radius) { _, value in onChange(value) }
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
  }

  private static func displayCornerRadius(_ proxy: GeometryProxy) -> CGFloat {
    ChromeMetrics.displayCornerRadius(
      isPad: UIDevice.current.userInterfaceIdiom == .pad, safeBottom: proxy.safeAreaInsets.bottom)
  }
}
