#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum Variant: String, CaseIterable {
  case light
  case dark
  case tinted

  var fileName: String {
    switch self {
    case .light: "AppIcon.png"
    case .dark: "AppIcon-Dark.png"
    case .tinted: "AppIcon-Tinted.png"
    }
  }
}

let size = 1024
let side = CGFloat(size)
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [red, green, blue, alpha])!
}

func gradient(_ colors: [CGColor], _ locations: [CGFloat]) -> CGGradient {
  CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations)!
}

func ringPath(center: CGPoint, width: CGFloat, height: CGFloat, angle: CGFloat) -> CGPath {
  var transform = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: angle)
  return CGPath(ellipseIn: CGRect(x: -width / 2, y: -height / 2, width: width, height: height), transform: &transform)
}

func render(_ variant: Variant) -> CGImage {
  let alphaInfo: CGImageAlphaInfo = variant == .light ? .noneSkipLast : .premultipliedLast
  let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
    bitmapInfo: alphaInfo.rawValue)!
  context.setAllowsAntialiasing(true)
  context.setShouldAntialias(true)
  context.interpolationQuality = .high

  switch variant {
  case .light:
    context.drawLinearGradient(
      gradient(
        [color(0.53, 0.57, 0.98), color(0.72, 0.55, 0.96), color(0.97, 0.63, 0.80)], [0, 0.55, 1]),
      start: CGPoint(x: 0, y: side), end: CGPoint(x: side, y: 0), options: [])
  case .dark, .tinted:
    context.clear(CGRect(x: 0, y: 0, width: side, height: side))
  }

  let center = CGPoint(x: side * 0.5, y: side * 0.5)
  let angle = CGFloat.pi * 0.12
  let ringWidth = side * 0.80
  let ringHeight = side * 0.28
  let ringStroke = side * 0.036
  let planetRadius = side * 0.205

  let ringColor: CGColor
  let planetColors: [CGColor]
  let moonColor: CGColor
  switch variant {
  case .light:
    ringColor = color(1, 1, 1, 0.62)
    planetColors = [color(1, 1, 1), color(0.88, 0.86, 0.99)]
    moonColor = color(1, 1, 1)
  case .dark:
    ringColor = color(0.78, 0.68, 0.99, 0.85)
    planetColors = [color(0.80, 0.78, 1.0), color(0.62, 0.50, 0.96)]
    moonColor = color(0.98, 0.72, 0.86)
  case .tinted:
    ringColor = color(0.82, 0.82, 0.82, 1)
    planetColors = [color(1, 1, 1), color(0.86, 0.86, 0.86)]
    moonColor = color(1, 1, 1)
  }

  let ring = ringPath(center: center, width: ringWidth, height: ringHeight, angle: angle)

  func strokeRingHalf(front: Bool) {
    context.saveGState()
    var local = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: angle)
    let half = CGRect(x: -side, y: front ? -side : 0, width: side * 2, height: side)
    context.addPath(CGPath(rect: half, transform: &local))
    context.clip()
    context.addPath(ring)
    context.setStrokeColor(ringColor)
    context.setLineWidth(ringStroke)
    context.strokePath()
    context.restoreGState()
  }

  strokeRingHalf(front: false)

  context.saveGState()
  context.setShadow(offset: CGSize(width: 0, height: -side * 0.012), blur: side * 0.05, color: color(0.15, 0.08, 0.35, 0.35))
  context.addEllipse(in: CGRect(x: center.x - planetRadius, y: center.y - planetRadius, width: planetRadius * 2, height: planetRadius * 2))
  context.clip()
  context.drawRadialGradient(
    gradient(planetColors, [0, 1]),
    startCenter: CGPoint(x: center.x - planetRadius * 0.35, y: center.y + planetRadius * 0.4), startRadius: 0,
    endCenter: center, endRadius: planetRadius * 1.15, options: [.drawsAfterEndLocation])
  context.restoreGState()

  strokeRingHalf(front: true)

  let moonAngle = CGFloat.pi * 0.2
  let moonLocal = CGPoint(x: cos(moonAngle) * ringWidth / 2, y: sin(moonAngle) * ringHeight / 2)
  let moon = moonLocal.applying(CGAffineTransform(rotationAngle: angle)).applying(CGAffineTransform(translationX: center.x, y: center.y))
  let moonRadius = side * 0.048
  context.setFillColor(moonColor)
  context.addEllipse(in: CGRect(x: moon.x - moonRadius, y: moon.y - moonRadius, width: moonRadius * 2, height: moonRadius * 2))
  context.fillPath()

  return context.makeImage()!
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  FileHandle.standardError.write("usage: generate-icon.swift <AppIcon.appiconset>\n".data(using: .utf8)!)
  exit(1)
}
let output = URL(fileURLWithPath: arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for variant in Variant.allCases {
  let url = output.appendingPathComponent(variant.fileName)
  let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, render(variant), nil)
  guard CGImageDestinationFinalize(destination) else { exit(1) }
}
let contents = """
  {
    "images" : [
      { "filename" : "AppIcon.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
      { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ], "filename" : "AppIcon-Dark.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
      { "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ], "filename" : "AppIcon-Tinted.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
    ],
    "info" : { "author" : "xcode", "version" : 1 }
  }

  """
try contents.write(to: output.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
