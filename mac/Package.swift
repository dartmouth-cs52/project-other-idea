// swift-tools-version:5.9
import PackageDescription

// Haptic for Mac apps. HapticKit is what a company adds to its own app, as the
// script tag is what it adds to its site. HapticDemo is a small app to try it on,
// and Northpine is a large one, with everything a real Mac app has.
let package = Package(
    name: "HapticKit",
    platforms: [.macOS(.v13)],
    products: [.library(name: "HapticKit", targets: ["HapticKit"])],
    targets: [
        .target(name: "HapticKit"),
        .executableTarget(name: "HapticDemo", dependencies: ["HapticKit"]),
        .executableTarget(name: "Northpine", dependencies: ["HapticKit"]),
        .testTarget(name: "HapticKitTests", dependencies: ["HapticKit"]),
    ]
)
