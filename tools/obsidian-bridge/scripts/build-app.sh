#!/bin/bash
# Builds "Obsidian Bridge.app" (menu bar app) with the Swift compiler from the Command Line Tools. No Xcode required.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MACOS="$HERE/../macos"
CORE="$HERE/../core"
OUT="$MACOS/build/Obsidian Bridge.app"
NODE="$(command -v node || true)"

[ -n "$NODE" ] || { echo "Node.js was not found."; exit 1; }
[ -f "$CORE/dist/cli/main.js" ] || { echo "Build the Core first: $HERE/build.sh"; exit 1; }

cd "$MACOS"
swift build -c release
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp .build/release/ObsidianBridgeMenu "$OUT/Contents/MacOS/"
cp Resources/Info.plist "$OUT/Contents/Info.plist"
# where node and the Core's command line are (the app runs them; this machine only)
printf '{"node":"%s","cli":"%s"}\n' "$NODE" "$(cd "$CORE" && pwd)/dist/cli/main.js" > "$OUT/Contents/Resources/bridge-paths.json"
codesign --force --sign - "$OUT" >/dev/null 2>&1 || echo "(ad-hoc signing skipped)"
echo "Built: $OUT"
