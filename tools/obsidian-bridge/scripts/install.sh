#!/bin/bash
# Installs the Bridge as a LaunchAgent for YOUR user (no root, no changes to your shell config).
# It starts at login, restarts after a crash, and stops cleanly at logout. Run setup first: obsidian-bridge setup
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$HERE/../core"
LABEL="com.jameswebpupu.obsidian-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
LOGDIR="$HOME/Library/Application Support/ObsidianBridge/logs"

[ -n "$NODE" ] || { echo "Node.js was not found. Install Node 22.5 or newer first."; exit 1; }
[ -f "$CORE/dist/cli/main.js" ] || { echo "Not built yet. Run: $HERE/build.sh"; exit 1; }

echo "This will:"
echo "  - write $PLIST"
echo "  - start the Bridge now and at every login (it runs: $NODE $CORE/dist/cli/main.js run)"
echo "It will not touch your vault, shell files or system settings. Remove it any time with uninstall.sh."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Continue? (yes/no) " ans
  [ "$ans" = "yes" ] || { echo "Cancelled."; exit 1; }
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$CORE/dist/cli/main.js</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGDIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/launchd.err.log</string>
</dict>
</plist>
PLISTEOF
chmod 644 "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Check it with: obsidian-bridge status"
