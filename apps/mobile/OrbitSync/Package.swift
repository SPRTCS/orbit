// swift-tools-version:6.0
import PackageDescription

let package = Package(
  name: "OrbitSync",
  platforms: [.iOS("26.0"), .macOS(.v15)],
  products: [.library(name: "OrbitSync", targets: ["OrbitSync"])],
  dependencies: [.package(path: "../../../packages/sync")],
  targets: [
    .target(name: "OrbitSync"),
    .testTarget(
      name: "OrbitSyncTests",
      dependencies: [
        "OrbitSync",
        .product(name: "ArdiaSyncCore", package: "sync", condition: .when(platforms: [.macOS])),
      ],
      exclude: ["Interop"]
    ),
  ]
)
