#!/bin/bash
# Stops the Bridge and removes its LaunchAgent. Your vault, backups, config and Keychain entry are left alone.
set -euo pipefail
LABEL="com.jameswebpupu.obsidian-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed the LaunchAgent."
echo "Not removed (do it yourself if you want to):"
echo "  - settings and state:  ~/Library/Application Support/ObsidianBridge"
echo "  - Keychain entry:      obsidian-bridge unpair   (also tells LifeOS to forget this Mac)"
