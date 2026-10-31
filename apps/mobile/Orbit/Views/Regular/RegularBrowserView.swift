import SwiftUI

struct RegularBrowserView: View {
  @Environment(BrowserModel.self) private var browser
  @Environment(\.verticalSizeClass) private var verticalSizeClass
  @AppStorage("sidebarWidth.verticalRegular") private var storedWidthTall = SidebarWidth.defaultWidth
  @AppStorage("sidebarWidth.verticalCompact") private var storedWidthShort = SidebarWidth.defaultWidth

  private let cardInset: CGFloat = 8

  var body: some View {
    GeometryReader { proxy in
      let safeArea = proxy.safeAreaInsets
      let windowWidth = proxy.size.width + safeArea.leading + safeArea.trailing
      let range = SidebarWidth.range(windowWidth: windowWidth)
      let sidebarWidth = min(max(storedWidth, range.lowerBound), range.upperBound)
      let edgeGap = ChromeMetrics.edgeGap(
        displayCornerRadius: browser.morph.displayCornerRadius, controlSize: ChromeMetrics.regularControlSize,
        safeBottom: safeArea.bottom)
      ZStack {
        OrbitBackdrop(tint: browser.currentSpace?.tint)
        HStack(spacing: 0) {
          if browser.isSidebarVisible {
            SidebarView(width: sidebarWidth, safeArea: safeArea, edgeGap: edgeGap)
              .frame(width: sidebarWidth)
              .transition(.move(edge: .leading).combined(with: .opacity))
            SidebarResizeHandle(width: widthBinding, range: range)
          }
          contentColumn(
            safeArea: safeArea, edgeGap: edgeGap,
            contentWidth: windowWidth - (browser.isSidebarVisible ? sidebarWidth + SidebarResizeHandle.width : cardInset) - cardInset)
        }
        .animation(.snappy(duration: 0.3), value: browser.isSidebarVisible)
        if browser.isShowingTabSwitcher {
          TabSwitcherView()
            .ignoresSafeArea(.keyboard)
            .transition(.opacity)
            .zIndex(1)
        }
        OverviewMorphLayer()
          .zIndex(1.5)
        if browser.entry.isPresented {
          let besideSidebar = browser.isSidebarVisible && !browser.isShowingTabSwitcher
          AddressEntryOverlay(
            layout: .regular,
            leadingInset: besideSidebar ? sidebarWidth + SidebarResizeHandle.width - safeArea.leading : 0,
            trailingInset: cardInset
          )
          .transition(.opacity.combined(with: .move(edge: .bottom)))
          .zIndex(2)
        }
      }
      .ignoresSafeArea(.container)
    }
  }

  private var storedWidth: Double {
    verticalSizeClass == .compact ? storedWidthShort : storedWidthTall
  }

  private var widthBinding: Binding<CGFloat> {
    Binding(
      get: { CGFloat(storedWidth) },
      set: { newValue in
        if verticalSizeClass == .compact { storedWidthShort = Double(newValue) } else { storedWidthTall = Double(newValue) }
      })
  }

  private func contentColumn(safeArea: EdgeInsets, edgeGap: CGFloat, contentWidth: CGFloat) -> some View {
    let inset = cardInset
    let metrics = ChromeMetrics.regular(
      edgeGap: edgeGap, cardInset: inset, safeBottom: safeArea.bottom, width: contentWidth)
    let cardShape = PageCardShape.shape(besideSidebar: browser.isSidebarVisible)
    return ZStack(alignment: .bottom) {
      BrowserContent(bottomObscured: metrics.obscured(collapsed: browser.chromeCollapsed), ignoresSafeArea: true)
      BottomChrome(style: .regular, metrics: metrics)
    }
    .clipShape(cardShape)
    .background(cardShape.fill(.background).shadow(color: .black.opacity(0.22), radius: 10, y: 3))
    .reportsGlobalFrame { frame in
      browser.morph.pageFrame = frame
      browser.morph.pageCornerRadius = PageCardShape.sidebarCornerRadius
    }
    .ignoresSafeArea(.keyboard)
    .padding(.vertical, inset)
    .padding(.trailing, inset)
    .padding(.leading, browser.isSidebarVisible ? 0 : inset)
  }
}

enum SidebarWidth {
  static let defaultWidth: Double = 290
  static let minimum: CGFloat = 240
  static let maximum: CGFloat = 420

  static func range(windowWidth: CGFloat) -> ClosedRange<CGFloat> {
    minimum...max(minimum, min(maximum, windowWidth * 0.4))
  }

  static func tileColumns(forSidebarWidth width: CGFloat) -> Int {
    if width >= 400 { return 4 }
    if width < 230 { return 2 }
    return 3
  }
}

struct SidebarResizeHandle: View {
  static let width: CGFloat = 10

  @Binding var width: CGFloat
  let range: ClosedRange<CGFloat>
  @State private var dragStartWidth: CGFloat?
  @State private var isHovering = false

  var body: some View {
    ResizeHandleSurface(
      onHover: { isHovering = $0 },
      onDrag: { translation in
        let start = dragStartWidth ?? width
        dragStartWidth = start
        width = min(max(start + translation, range.lowerBound), range.upperBound)
      },
      onDragEnded: { dragStartWidth = nil },
      onDoubleTap: {
        withAnimation(.snappy(duration: 0.3)) { width = CGFloat(SidebarWidth.defaultWidth) }
      }
    )
    .frame(width: Self.width)
    .frame(maxHeight: .infinity)
    .overlay {
      Capsule()
        .fill(.secondary)
        .frame(width: 3, height: 44)
        .opacity(dragStartWidth != nil ? 0.8 : (isHovering ? 0.5 : 0))
        .animation(.easeOut(duration: 0.15), value: isHovering)
        .allowsHitTesting(false)
    }
    .accessibilityElement()
    .accessibilityLabel("Sidebar width")
    .accessibilityValue("\(Int(width)) points")
    .accessibilityAdjustableAction { direction in
      let step: CGFloat = direction == .increment ? 20 : -20
      width = min(max(width + step, range.lowerBound), range.upperBound)
    }
  }
}

struct ResizeHandleSurface: UIViewRepresentable {
  var onHover: (Bool) -> Void
  var onDrag: (CGFloat) -> Void
  var onDragEnded: () -> Void
  var onDoubleTap: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(surface: self)
  }

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.backgroundColor = .clear
    let coordinator = context.coordinator
    view.addInteraction(UIPointerInteraction(delegate: coordinator))
    view.addGestureRecognizer(UIHoverGestureRecognizer(target: coordinator, action: #selector(Coordinator.hover(_:))))
    let pan = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.pan(_:)))
    pan.maximumNumberOfTouches = 1
    view.addGestureRecognizer(pan)
    let doubleTap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.doubleTap))
    doubleTap.numberOfTapsRequired = 2
    view.addGestureRecognizer(doubleTap)
    return view
  }

  func updateUIView(_ view: UIView, context: Context) {
    context.coordinator.surface = self
  }

  final class Coordinator: NSObject, UIPointerInteractionDelegate {
    var surface: ResizeHandleSurface

    init(surface: ResizeHandleSurface) {
      self.surface = surface
    }

    @objc func hover(_ recognizer: UIHoverGestureRecognizer) {
      switch recognizer.state {
      case .began, .changed: surface.onHover(true)
      default: surface.onHover(false)
      }
    }

    @objc func pan(_ recognizer: UIPanGestureRecognizer) {
      switch recognizer.state {
      case .began, .changed: surface.onDrag(recognizer.translation(in: recognizer.view?.window).x)
      default: surface.onDragEnded()
      }
    }

    @objc func doubleTap() {
      surface.onDoubleTap()
    }

    func pointerInteraction(_ interaction: UIPointerInteraction, styleFor region: UIPointerRegion) -> UIPointerStyle? {
      UIPointerStyle(shape: .path(Self.resizeArrows), constrainedAxes: [])
    }

    private static let resizeArrows: UIBezierPath = {
      let path = UIBezierPath()
      let halfWidth: CGFloat = 11
      let headLength: CGFloat = 5
      let headHeight: CGFloat = 5
      let shaft: CGFloat = 1.5
      path.move(to: CGPoint(x: -halfWidth, y: 0))
      path.addLine(to: CGPoint(x: -halfWidth + headLength, y: -headHeight))
      path.addLine(to: CGPoint(x: -halfWidth + headLength, y: -shaft))
      path.addLine(to: CGPoint(x: halfWidth - headLength, y: -shaft))
      path.addLine(to: CGPoint(x: halfWidth - headLength, y: -headHeight))
      path.addLine(to: CGPoint(x: halfWidth, y: 0))
      path.addLine(to: CGPoint(x: halfWidth - headLength, y: headHeight))
      path.addLine(to: CGPoint(x: halfWidth - headLength, y: shaft))
      path.addLine(to: CGPoint(x: -halfWidth + headLength, y: shaft))
      path.addLine(to: CGPoint(x: -halfWidth + headLength, y: headHeight))
      path.close()
      return path
    }()
  }
}

struct LayoutRegionInsetsReader: UIViewRepresentable {
  let onChange: (EdgeInsets) -> Void

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
    var onChange: ((EdgeInsets) -> Void)?
    private var lastInsets: UIEdgeInsets?

    override func layoutSubviews() {
      super.layoutSubviews()
      report()
    }

    override func safeAreaInsetsDidChange() {
      super.safeAreaInsetsDidChange()
      report()
    }

    func report() {
      guard window != nil else { return }
      let insets = edgeInsets(for: .margins(cornerAdaptation: .horizontal))
      guard insets != lastInsets else { return }
      lastInsets = insets
      let callback = onChange
      let edgeInsets = EdgeInsets(top: insets.top, leading: insets.left, bottom: insets.bottom, trailing: insets.right)
      DispatchQueue.main.async { callback?(edgeInsets) }
    }
  }
}

enum PageCardShape {
  static let sidebarCornerRadius: CGFloat = 14

  static func shape(besideSidebar: Bool) -> ConcentricRectangle {
    let displayCorner: Edge.Corner.Style = .concentric(minimum: .fixed(10))
    let sidebarCorner: Edge.Corner.Style = besideSidebar ? .fixed(sidebarCornerRadius) : displayCorner
    return ConcentricRectangle(
      topLeadingCorner: sidebarCorner, topTrailingCorner: displayCorner, bottomLeadingCorner: sidebarCorner,
      bottomTrailingCorner: displayCorner)
  }
}
