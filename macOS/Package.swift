// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChirpberryCore",
    platforms: [.macOS(.v14)],
    products: [.library(name: "ChirpberryCore", targets: ["ChirpberryCore"]),
               .executable(name: "chirpberry-mcp", targets: ["ChirpberryMCP"])],
    targets: [.target(name: "ChirpberryCore"),
              .executableTarget(name: "ChirpberryMCP", dependencies: ["ChirpberryCore"]),
              .testTarget(name: "ChirpberryCoreTests", dependencies: ["ChirpberryCore"])],
    swiftLanguageModes: [.v5]
)
