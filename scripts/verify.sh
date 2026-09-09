#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
swift test --package-path macOS
swift build --package-path macOS --product chirpberry-mcp
python3 scripts/test-mcp.py
bash scripts/test-regressions.sh
npm test --prefix site
npm run build --prefix site
scripts/build.sh
git diff --check
