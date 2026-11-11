# Obsidian Bridge

A small service that runs on your Mac. It sends **only the notes you marked** to LifeOS so Claude can search and read them, and it applies changes you approved in LifeOS. Obsidian stays the source of truth: your vault never leaves the Mac.

Status: the Core (TypeScript), the command line, backups and restore are done. The Menu Bar app comes in a later phase (see `docs/adr/0002-obsidian-bridge.md`).

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
`setup`, `status`, `doctor`, `sync [--allow-removals]`, `pause`, `resume`, `backup [list]`, `restore preview|--new-vault|--merge`, `logs`, `pair`, `unpair`, `reenable <note id>`, `run`, `version`. Use `obsidian-bridge help <command>`.

## Security
- The device token is in the macOS Keychain, never in a file, the vault or Git. Config and state files are private to your user (0600).
- The Bridge listens on a private Unix socket (0600) only. No network port is opened.
- Every request to LifeOS carries the token; LifeOS refuses revoked or unknown devices.
- Logs never contain note text or tokens.
- Paths are validated on every operation: no `..`, no hidden folders (`.obsidian`, `.trash`), no symlinks leaving the vault, and existing files are never overwritten.

## Approved changes from Claude
Claude can propose creating, editing, renaming, moving and deleting notes and folders. Nothing happens until you approve in LifeOS. The Mac then checks that the approval hasn't expired, the path is safe, nothing is in the way, the note is unchanged since the proposal (otherwise it stops with a diff and asks for a fresh approval), and a safety backup exists for anything that changes or removes existing content. Deleted items go to Obsidian's `.trash`, never removed. If the local backup cannot be made, edits, moves and deletes are refused on purpose.

## Offline behaviour
Polling is every 15 seconds, with bounded backoff (up to about 5 minutes) when offline; it checks again straight away after sleep. If the Mac is off, Claude can still search what was synced earlier, and approved changes wait. Revoking a note in LifeOS removes it from the cloud at once; the Mac applies the change (turns `lifeos_sync` off) when it reconnects, and a revoked note is never uploaded again until you re-enable it.

## Tests
```
cd tools/obsidian-bridge/core && npm test
```
The website's own test suite also runs the Bridge against the real Worker routes (`tests/bridge-integration.test.ts`).
`src/shared/` holds copies of files from the website (`npm run sync-shared`); a test fails if they drift.

## Backups and restore
- Everything in the vault is backed up: notes, folders (including empty ones), PDFs, images, templates, `.obsidian` settings and plugins, `.trash`, hidden files. Left out: only `*.bridge-tmp` files the Bridge itself writes, and `.DS_Store`. Tokens and Keychain entries are not in the vault, so they are never backed up.
- Destinations: the local folder (required) and an external SSD (optional, found by its volume id wherever macOS mounts it). Each is reported separately and only counts as successful after verification.
- Schedule (Mac's local time): daily 02:00 keep 7, Sunday 02:00 keep 4, the 1st at 02:00 keep 3. A missed night runs once when the Mac is back. One backup can carry several labels without a duplicate copy. Safety backups (before Claude changes something) keep the newest 10; manual ones the newest 5.
- Every restore point is a complete folder on its own. Unchanged files in daily backups are hard links to the previous one; the first, weekly and monthly backups copy every file. Deleting an old backup never affects another.
- Verification is basic: manifest present, file count and paths match, sizes match, every file readable. It is not a full checksum scan.
- Restore: `restore preview` changes nothing; `--new-vault <folder>` restores into a new folder; `--merge` makes a safety backup, adds missing files, skips identical ones, and for files that differ lets you keep current, keep both (a "(restored …)" copy; links inside notes are not rewritten) or restore the backup version (needs explicit confirmation).
- Backup to an unencrypted drive is refused unless you accepted that warning during setup. The Bridge never formats a drive.
