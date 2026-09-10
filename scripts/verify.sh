#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
swift test --package-path macOS
swift build --package-path macOS --product chirpberry-mcp
python3 scripts/test-mcp.py
npm test --prefix site
npm run build --prefix site
npm run build:native --prefix desktop
npm run verify --prefix desktop
scripts/build.sh
xcodebuild -project macOS/Chirpberry.xcodeproj -scheme ChirpberryModelTests \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath macOS/.build/model-tests test
git diff --check
