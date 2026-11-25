// swift-tools-version:5.9
import PackageDescription

// Haptic for Mac apps. HapticKit is what a company adds to its own app, as the
// script tag is what it adds to its site.
let package = Package(
    name: "HapticKit",
    platforms: [.macOS(.v13)],
    products: [.library(name: "HapticKit", targets: ["HapticKit"])],
    targets: [
        .target(name: "HapticKit"),
        .testTarget(name: "HapticKitTests", dependencies: ["HapticKit"]),
    ]
)
