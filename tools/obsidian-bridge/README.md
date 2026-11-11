# Obsidian Bridge

A small service that runs on your Mac. It sends **only the notes you marked** to LifeOS so Claude can search and read them, and it applies changes you approved in LifeOS. Obsidian stays the source of truth: your vault never leaves the Mac.

Status: the Core (TypeScript) and the command line are done. The Menu Bar app, backups and restore come in later phases (see `docs/adr/0002-obsidian-bridge.md`).

## How it decides what to share
- A note is shared only if its frontmatter has `lifeos_sync: true` (the exact word `true`). No flag, `false`, `"true"` in quotes or `yes` all mean "not shared".
- Folders don't share anything. Linking to a note doesn't share it. A link to a local-only note stays as text; the target's content is never sent.
- A shared note without an `id` gets a UUID added as one frontmatter line (nothing else in the file changes). Invalid or duplicate ids are reported and those notes are not synced.
- Images are never uploaded. In the cloud copy they appear as `[Image attachment: name.png — not synchronized]`.
- PDFs referenced from a shared note (`![[x.pdf]]`, `[[x.pdf]]`, `[t](./x.pdf)`) have their selectable text extracted on this Mac (Apple PDFKit). Only the text goes to LifeOS, split by page. Files over 100 MB are skipped. Scanned PDFs get the status `no_text`; there is no OCR in this version.
- Before anything is uploaded the text is scanned for secrets (keys, tokens, private keys, passwords). A note with a finding is held back, shown masked in LifeOS, and stays on your Mac. You can approve single findings in LifeOS; an approval only counts for that exact content. The scanner is a safety net, not a guarantee.

## Install and set up
```
tools/obsidian-bridge/scripts/build.sh          # needs Node 22.5+ and the Command Line Tools (swiftc)
node tools/obsidian-bridge/core/dist/cli/main.js setup
```
Setup asks for your vault, a backup folder, checks FileVault, pairs with a one-time code from LifeOS (Settings → Obsidian) and shows a preview of the first sync as numbers only. **Nothing is uploaded until you confirm it.**
To start at login: `tools/obsidian-bridge/scripts/install.sh` (asks first, no root). Remove with `uninstall.sh`.

## Commands
`setup`, `status`, `doctor`, `sync`, `pause`, `resume`, `backup` and `restore` (not available yet), `logs`, `pair`, `unpair`, `reenable <note id>`, `run`, `version`. Use `obsidian-bridge help <command>`.

## Security
- The device token is in the macOS Keychain, never in a file, the vault or Git. Config and state files are private to your user (0600).
- The Bridge listens on a private Unix socket (0600) only. No network port is opened.
- Every request to LifeOS carries the token; LifeOS refuses revoked or unknown devices.
- Logs never contain note text or tokens.
- Paths are validated on every operation: no `..`, no hidden folders (`.obsidian`, `.trash`), no symlinks leaving the vault, and existing files are never overwritten.

## Approved changes from Claude
Claude can propose creating, editing, renaming, moving and deleting notes and folders. Nothing happens until you approve in LifeOS. The Mac then checks that the approval hasn't expired, the path is safe, nothing is in the way, the note is unchanged since the proposal (otherwise it stops with a diff and asks for a fresh approval), and a safety backup exists for anything that changes or removes existing content. Deleted items go to Obsidian's `.trash`, never removed. Until backups are set up (next phase), edits, moves and deletes are refused on purpose.

## Offline behaviour
Polling is every 15 seconds, with bounded backoff (up to about 5 minutes) when offline; it checks again straight away after sleep. If the Mac is off, Claude can still search what was synced earlier, and approved changes wait. Revoking a note in LifeOS removes it from the cloud at once; the Mac applies the change (turns `lifeos_sync` off) when it reconnects, and a revoked note is never uploaded again until you re-enable it.

## Tests
```
cd tools/obsidian-bridge/core && npm test
```
The website's own test suite also runs the Bridge against the real Worker routes (`tests/bridge-integration.test.ts`).
`src/shared/` holds copies of files from the website (`npm run sync-shared`); a test fails if they drift.
