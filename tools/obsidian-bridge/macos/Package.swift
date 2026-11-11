// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ObsidianBridgeMenu",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ObsidianBridgeMenu", targets: ["ObsidianBridgeMenu"])],
    targets: [.executableTarget(name: "ObsidianBridgeMenu", path: "Sources/ObsidianBridgeMenu")]
)
