# Obsidian Bridge menu bar app (macOS)

A small SwiftUI app: a menu bar icon, a Setup Wizard and a Settings window. It holds **no sync logic**. It talks to the
Bridge service over its private Unix socket (`~/Library/Application Support/ObsidianBridge/bridge.sock`, mode 0600) and
runs the Core's own command line for the wizard steps, so the menu, the Terminal and the service always agree.

## Build (no Xcode needed, Command Line Tools are enough)
```
../scripts/build.sh          # builds the Core first
../scripts/build-app.sh      # builds this app into build/Obsidian Bridge.app
open "build/Obsidian Bridge.app"
```
The app is signed ad hoc, not notarized. The first time, right-click it → Open and confirm. It is a menu bar app (no Dock icon).

## What it does
- Menu: status, last sync, approvals (waiting for you / for this Mac), local and external backup status, Sync now, Pause/Resume, Back up now, View pending actions, Open LifeOS, Open Vault, View logs, Settings.
- Setup Wizard (6 screens): vault, backups (local, optional external, encryption warnings), system checks (Node, FileVault, PDF reader, folder access), pair with LifeOS (one-time code), first-sync preview and explicit confirmation, finish (optional login item).
- Settings: connection info, start at login (a user LaunchAgent, only after you confirm), stop/start, re-run setup.

## Permissions
- Folder choosing uses the standard macOS panel. The Bridge service itself (Node) needs access to your vault and backup folders; if macOS asks, allow it, or add Node under System Settings → Privacy & Security → Files and Folders / Full Disk Access.
- The device token is stored by the Core in the macOS Keychain (the app never sees it).
- No administrator rights are used anywhere.

## Check it from the Terminal
`"Obsidian Bridge.app/Contents/MacOS/ObsidianBridgeMenu" --print-status` prints the running service's status JSON.
