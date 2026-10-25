// swift-tools-version: 5.9
import PackageDescription

// みんなの遊び場の iPhone 側の小さな部品。書き方は @capacitor/haptics の Package.swift に合わせた。
let package = Package(
    name: "AsobibaNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "AsobibaNative",
            targets: ["AsobibaNativePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "AsobibaNativePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/AsobibaNativePlugin")
    ]
)
