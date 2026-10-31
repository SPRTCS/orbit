#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [red, green, blue, alpha])!
}

func gray(_ value: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
  color(value, value, value, alpha)
}

struct Palette {
  var background: [CGColor]?
  var ring: CGColor
  var planet: [CGColor]
  var moon: CGColor
}

struct Rendition {
  let file: String
  let appearance: String?
  let opaque: Bool
  let palette: Palette
}

struct IconSet {
  let id: String
  let setName: String
  let renditions: [Rendition]
}

let defaultBackground = [color(0.53, 0.57, 0.98), color(0.72, 0.55, 0.96), color(0.97, 0.63, 0.80)]
let lightMark = (ring: color(1, 1, 1, 0.62), planet: [color(1, 1, 1), color(0.88, 0.86, 0.99)], moon: color(1, 1, 1))
let violetMark = (ring: color(0.62, 0.52, 0.96, 0.85), planet: [color(0.80, 0.78, 1.0), color(0.55, 0.45, 0.94)], moon: color(0.96, 0.62, 0.80))
let monoMark = (ring: gray(1, 0.6), planet: [gray(1), gray(0.86)], moon: gray(1))

func palette(_ background: [CGColor]?, _ mark: (ring: CGColor, planet: [CGColor], moon: CGColor)) -> Palette {
  Palette(background: background, ring: mark.ring, planet: mark.planet, moon: mark.moon)
}

let sets: [IconSet] = [
  IconSet(id: "default", setName: "AppIcon", renditions: [
    Rendition(file: "AppIcon.png", appearance: nil, opaque: true, palette: palette(defaultBackground, lightMark)),
    Rendition(file: "AppIcon-Dark.png", appearance: "dark", opaque: false, palette: palette(nil, violetMark)),
    Rendition(file: "AppIcon-Tinted.png", appearance: "tinted", opaque: false,
      palette: Palette(background: nil, ring: gray(0.82), planet: [gray(1), gray(0.86)], moon: gray(1))),
  ]),
  IconSet(id: "midnight", setName: "AppIcon-Midnight", renditions: [
    Rendition(file: "AppIcon-Midnight.png", appearance: nil, opaque: true,
      palette: palette([color(0.20, 0.19, 0.22), color(0.07, 0.07, 0.08)], violetMark)),
  ]),
  IconSet(id: "daylight", setName: "AppIcon-Daylight", renditions: [
    Rendition(file: "AppIcon-Daylight.png", appearance: nil, opaque: true,
      palette: palette([color(1, 1, 1), color(0.90, 0.90, 0.91)], violetMark)),
  ]),
  IconSet(id: "plum", setName: "AppIcon-Plum", renditions: [
    Rendition(file: "AppIcon-Plum.png", appearance: nil, opaque: true,
      palette: palette([color(0.83, 0.56, 0.68), color(0.52, 0.28, 0.40)], lightMark)),
  ]),
  IconSet(id: "ocean", setName: "AppIcon-Ocean", renditions: [
    Rendition(file: "AppIcon-Ocean.png", appearance: nil, opaque: true,
      palette: palette([color(0.45, 0.70, 0.93), color(0.16, 0.36, 0.70)], lightMark)),
  ]),
  IconSet(id: "mono", setName: "AppIcon-Mono", renditions: [
    Rendition(file: "AppIcon-Mono.png", appearance: nil, opaque: true,
      palette: palette([gray(0.66), gray(0.62), gray(0.74)], monoMark)),
  ]),
  IconSet(id: "noir", setName: "AppIcon-Noir", renditions: [
    Rendition(file: "AppIcon-Noir.png", appearance: nil, opaque: true,
      palette: palette([gray(0.16), gray(0.03)], (ring: gray(0.85, 0.7), planet: [gray(0.95), gray(0.62)], moon: gray(1)))),
  ]),
]

func ringPath(center: CGPoint, width: CGFloat, height: CGFloat, angle: CGFloat) -> CGPath {
  var transform = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: angle)
  return CGPath(ellipseIn: CGRect(x: -width / 2, y: -height / 2, width: width, height: height), transform: &transform)
}

func render(_ palette: Palette, opaque: Bool, size: Int) -> CGImage {
  let side = CGFloat(size)
  let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
    bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast).rawValue)!
  context.interpolationQuality = .high
  if let background = palette.background {
    let stops = (0..<background.count).map { CGFloat($0) / CGFloat(max(background.count - 1, 1)) }
    context.drawLinearGradient(
      CGGradient(colorsSpace: space, colors: background as CFArray, locations: stops)!,
      start: CGPoint(x: 0, y: side), end: CGPoint(x: side, y: 0), options: [])
  } else {
    context.clear(CGRect(x: 0, y: 0, width: side, height: side))
  }

  let center = CGPoint(x: side * 0.5, y: side * 0.5)
  let angle = CGFloat.pi * 0.12
  let ringWidth = side * 0.80
  let ringHeight = side * 0.28
  let planetRadius = side * 0.205
  let ring = ringPath(center: center, width: ringWidth, height: ringHeight, angle: angle)

  func strokeRingHalf(front: Bool) {
    context.saveGState()
    var local = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: angle)
    context.addPath(CGPath(rect: CGRect(x: -side, y: front ? -side : 0, width: side * 2, height: side), transform: &local))
    context.clip()
    context.addPath(ring)
    context.setStrokeColor(palette.ring)
    context.setLineWidth(side * 0.036)
    context.strokePath()
    context.restoreGState()
  }

  strokeRingHalf(front: false)
  context.saveGState()
  context.setShadow(offset: CGSize(width: 0, height: -side * 0.012), blur: side * 0.05, color: color(0.15, 0.08, 0.35, 0.35))
  context.addEllipse(in: CGRect(x: center.x - planetRadius, y: center.y - planetRadius, width: planetRadius * 2, height: planetRadius * 2))
  context.clip()
  context.drawRadialGradient(
    CGGradient(colorsSpace: space, colors: palette.planet as CFArray, locations: [0, 1])!,
    startCenter: CGPoint(x: center.x - planetRadius * 0.35, y: center.y + planetRadius * 0.4), startRadius: 0,
    endCenter: center, endRadius: planetRadius * 1.15, options: [.drawsAfterEndLocation])
  context.restoreGState()
  strokeRingHalf(front: true)

  let moonAngle = CGFloat.pi * 0.2
  let moonLocal = CGPoint(x: cos(moonAngle) * ringWidth / 2, y: sin(moonAngle) * ringHeight / 2)
  let moon = moonLocal.applying(CGAffineTransform(rotationAngle: angle)).applying(CGAffineTransform(translationX: center.x, y: center.y))
  let moonRadius = side * 0.048
  context.setFillColor(palette.moon)
  context.addEllipse(in: CGRect(x: moon.x - moonRadius, y: moon.y - moonRadius, width: moonRadius * 2, height: moonRadius * 2))
  context.fillPath()
  return context.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) {
  let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { exit(1) }
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  FileHandle.standardError.write("usage: generate-icon.swift <Assets.xcassets>\n".data(using: .utf8)!)
  exit(1)
}
let catalog = URL(fileURLWithPath: arguments[1], isDirectory: true)
let manager = FileManager.default

for set in sets {
  let folder = catalog.appendingPathComponent("\(set.setName).appiconset", isDirectory: true)
  try? manager.removeItem(at: folder)
  try manager.createDirectory(at: folder, withIntermediateDirectories: true)
  var images: [String] = []
  for rendition in set.renditions {
    writePNG(render(rendition.palette, opaque: rendition.opaque, size: 1024), to: folder.appendingPathComponent(rendition.file))
    let appearance = rendition.appearance.map { "\"appearances\" : [ { \"appearance\" : \"luminosity\", \"value\" : \"\($0)\" } ], " } ?? ""
    images.append("    { \(appearance)\"filename\" : \"\(rendition.file)\", \"idiom\" : \"universal\", \"platform\" : \"ios\", \"size\" : \"1024x1024\" }")
  }
  let contents = "{\n  \"images\" : [\n\(images.joined(separator: ",\n"))\n  ],\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}\n"
  try contents.write(to: folder.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)

  let preview = catalog.appendingPathComponent("IconPreview-\(set.id).imageset", isDirectory: true)
  try? manager.removeItem(at: preview)
  try manager.createDirectory(at: preview, withIntermediateDirectories: true)
  writePNG(render(set.renditions[0].palette, opaque: true, size: 180), to: preview.appendingPathComponent("preview.png"))
  let previewContents = "{\n  \"images\" : [ { \"filename\" : \"preview.png\", \"idiom\" : \"universal\", \"scale\" : \"3x\" } ],\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}\n"
  try previewContents.write(to: preview.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
}
