#!/bin/bash
# Builds the Bridge core (TypeScript) and the native PDF reader. Needs Node 22.5+ and the Xcode Command Line Tools (swiftc).
set -euo pipefail
cd "$(dirname "$0")/../core"
npm install --no-audit --no-fund
npm run build
echo "Built: $(pwd)/dist/cli/main.js"
