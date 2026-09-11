#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
python3 scripts/prepare-icon.py
swift build --package-path macOS -c release --product chirpberry-mcp
mkdir -p macOS/Resources/bin
cp macOS/.build/release/chirpberry-mcp macOS/Resources/bin/chirpberry-mcp
cp LICENSE macOS/Resources/LICENSE.txt
xcodegen generate --spec macOS/project.yml
xcodebuild -project macOS/Chirpberry.xcodeproj -scheme Chirpberry -configuration Release \
  -derivedDataPath macOS/.build/xcode ARCHS=arm64 build
mkdir -p dist-native
ditto macOS/.build/xcode/Build/Products/Release/Chirpberry.app dist-native/Chirpberry.app
codesign --force --sign - dist-native/Chirpberry.app/Contents/Resources/bin/chirpberry-mcp
codesign --force --sign - dist-native/Chirpberry.app
codesign --verify --deep --strict dist-native/Chirpberry.app
echo "Built dist-native/Chirpberry.app"
