#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
mkdir -p macOS/Resources/bin
xcodegen generate --spec macOS/project.yml
xcodebuild -project macOS/Chirpberry.xcodeproj -scheme ChirpberryRegressionTests \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath macOS/.build/regressions \
  -only-testing:ChirpberryRegressionTests test
