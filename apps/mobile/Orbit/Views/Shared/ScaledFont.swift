import SwiftUI

struct ScaledSystemFont: ViewModifier {
  @ScaledMetric private var size: CGFloat
  private let weight: Font.Weight

  init(size: CGFloat, weight: Font.Weight, relativeTo style: Font.TextStyle) {
    _size = ScaledMetric(wrappedValue: size, relativeTo: style)
    self.weight = weight
  }

  func body(content: Content) -> some View {
    content.font(.system(size: size, weight: weight))
  }
}

extension View {
  func scaledFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> some View {
    modifier(ScaledSystemFont(size: size, weight: weight, relativeTo: style))
  }
}

enum ChromeTextSize {
  static let limit: ClosedRange<DynamicTypeSize> = .xSmall ... .accessibility1
}
