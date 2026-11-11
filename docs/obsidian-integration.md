# Obsidian integration (LifeOS × Obsidian × Claude)

Status: implemented on branch `main` locally, **not deployed**. Nothing here has run against production yet. See [Putting it live](#putting-it-live) for the steps only the owner can do.

Design decisions and the reasons behind them: `docs/adr/0002-obsidian-bridge.md`. Bridge package details: `tools/obsidian-bridge/README.md`.

## What it does
- Obsidian stays the **source of truth**. The vault never leaves the Mac.
- A small service on the Mac, the **Obsidian Bridge**, sends only the notes you marked to LifeOS (Cloudflare D1). Claude (claude.ai and mobile) can search and read those copies through the existing MCP server, **even when the Mac is off**.
- Claude can *propose* creating, editing, renaming, moving and deleting notes and folders. Nothing happens until you approve in LifeOS, and the Mac applies it when it is online.
- The Bridge also backs up the whole vault to a local folder and an optional external SSD, with restore.

```
Obsidian vault (Mac, source of truth)
      │ read / atomic write
Obsidian Bridge (Node service + CLI + SwiftUI menu bar app)
      │ HTTPS, device token from the macOS Keychain
LifeOS Worker  /api/obsidian/**   ── D1: shared notes, chunks, search index, tombstones, approvals
      │ existing /api/mcp
Claude (web / mobile)
```

## Selective sync
- A note is shared only if its frontmatter has `lifeos_sync: true` (the exact word; `false`, `"true"`, `yes`, or nothing all mean "not shared").
- Folders and links share nothing. A link to a local-only note stays as text; its content is never sent.
- A shared note without an `id` gets a UUID added as one frontmatter line. The rest of the file is untouched (tested with CRLF and a BOM). Invalid or duplicate ids are reported and those notes are not synced. The id survives renames, moves, edits and restores.
- Images are never uploaded; the cloud copy shows `[Image attachment: name.png — not synchronized]`.
- **PDFs** referenced from a shared note (`![[x.pdf]]`, `[[x.pdf]]`, `[t](./x.pdf)`) have their selectable text extracted on the Mac with Apple PDFKit and sent as page-numbered chunks. Original PDFs stay in the vault. Over 100 MB: skipped (`too_large`). No selectable text: `no_text`. **There is no OCR in this version.** Thai, English and Japanese were tested with generated PDFs; real-world PDFs can extract worse than test files.
- The first sync is never silent: setup shows a numbers-only preview and needs your confirmation.
- After that the Bridge watches the vault (debounced), re-checks at startup, after sleep and every 10 minutes, and uploads only what changed (hash based). Moves/renames are detected by id and only update the path.
- Safety brake: if more than half of the synced notes (and more than 10) look gone at once, nothing is removed from the cloud (a missing drive must not wipe the copy).

## Secrets
Before anything leaves the Mac the text (notes, PDF text, Claude-written notes) is scanned: known key formats, private keys, `password = ...` style assignments and long random-looking strings. A hit holds that note back (`blocked_secret`), shows it masked in LifeOS (type, line, first 4 characters), and keeps it local. You can approve **one finding at a time**; an approval is bound to the exact content and disappears when the note changes. The Worker scans again on upload and on proposals as a second line of defence.
**This is a safety net, not a guarantee.** It cannot recognise every password or secret. A note Claude proposes that contains a possible secret can still be created on the Mac if you approve it, but it stays unsynced until it passes.

## Pairing and device security
LifeOS makes a one-time code (8 characters, 10 minutes, stored hashed, wrong guesses rate limited). The Mac trades it for a random 256-bit device token. LifeOS stores only its SHA-256; the Mac stores it in the macOS Keychain (written through `security -i`, so it never appears in a process list). Every Bridge request carries the token. A revoked device gets `device_revoked` and stops; unknown tokens count toward a per-IP lockout, valid tokens never do. The Bridge listens only on a private Unix socket (mode 0600). The browser-cookie `api()` wrapper is unchanged; the Bridge uses a separate `deviceApi()`.

## Approvals for vault changes
1. Claude calls a `propose_*` tool (nine of them). The Worker validates the path, checks the change makes sense against what Claude may see, scans for secrets, limits the size to 1 MB, **encrypts the payload (AES-256-GCM, fresh nonce, key in the `OBSIDIAN_PAYLOAD_KEY` Worker secret)** and creates an approval row. This is server-side encryption, not end-to-end: the Worker can read the text while processing it.
2. You review the exact change in LifeOS → Approvals (path, full text or diff, affected synced notes) and approve or reject.
3. Approving starts the execution clock. The Mac claims the command (once), and checks: not expired, path safe, nothing in the way, note unchanged since the proposal, and a **safety backup** done for anything that changes or removes existing content. Then it applies it atomically and reports back. Payload text is deleted after use.

| Operation | Expiry (from approval once approved; from proposal while waiting) |
|---|---|
| Create note / Create folder | 30 days |
| Edit / Rename / Move note, Rename / Move folder | 7 days |
| Delete note / Delete folder | 24 hours |

- Never overwrites. A taken destination is rejected and Claude has to propose another name; no numbered names are invented.
- **Conflicts:** if the note changed after the proposal (even while the Mac was offline for days) the Mac stops, keeps your version, reports the diff and the approval needs to be asked for again.
- Deletes move to the vault's `.trash`; nothing is removed permanently.
- Claude can only target notes and folders that contain a synced note. Anything else looks like it does not exist.
- A result that could not be delivered is stored and resent; a command is never run twice.
- Folder deletes: LifeOS shows the synced notes and PDFs that are affected. **The number of local-only files inside the folder is not shown before approval** (only the Mac knows it). The approval says that unshared files inside move too, and the Mac reports the counts by type after applying. Local-only file names are never sent.

## Revoke
Revoke a note in LifeOS (works even if the Mac is off): its text, PDF text, chunks and search entries are deleted from the current database in one batch, a **tombstone with a higher permission version** is written, and Claude stops seeing it immediately. The Mac applies it when it reconnects by switching the note's `lifeos_sync` to `false`. A stale upload can never bring it back; even an old copy of the file that says `true` stays out. Re-enabling needs you (in LifeOS, or `obsidian-bridge reenable <id>` on the Mac), a fresh secret scan and a new permission version.
**Cloudflare D1 Time Travel can keep earlier database states for up to 7 days on the free plan. Revoke removes current data and stops access at once; it cannot purge those provider-held copies.** Revocation tombstones are part of the existing KV backup (no note content is), and restoring merges them (a higher version always wins) before the search index is rebuilt. After a database rollback run **Reconcile** (`POST /api/obsidian/reconcile`): it re-applies tombstones, deletes anything revoked that came back and rebuilds search. Search stays closed until that finishes.

## Search
D1 FTS5 with the trigram tokenizer: Thai (no spaces needed), Japanese, English, identifiers like `useEffect` / `HashMap` / `SQL JOIN`, punctuation. Words under 3 characters fall back to `LIKE` over the 5,000 newest chunks, so they are slower and cover less. There is no word segmentation: Thai and Japanese are matched as substrings. Results are one per document with a bounded excerpt. Text is stored NFC-normalised.

## What is backed up where
- **LifeOS cloud backup (KV):** only `obsidian_revocations` is added. No note text, PDF text, chunks, search index, approval payloads or tokens.
- **Vault backups (on the Mac):** everything in the vault: notes, folders (including empty ones), PDFs, images, templates, `.obsidian` settings and plugins, `.trash`, hidden files. Left out: `*.bridge-tmp` files the Bridge writes, and `.DS_Store`.
  - Destinations: local folder (required) and external SSD (optional, found by volume id, so any mount name works). Each is reported separately, and counts as successful only after verification.
  - Schedule (Mac's local time): daily 02:00 keep 7, Sunday 02:00 keep 4, the 1st at 02:00 keep 3. A missed night runs once when the Mac is back. One backup can carry several labels. Safety backups keep the newest 10, manual ones the newest 5.
  - Each restore point is a complete folder. Unchanged files in daily backups are hard links to the previous backup; the first, weekly and monthly backups copy everything. Deleting an old backup never affects another. Old backups are deleted only after the new one verified, and nothing is deleted if a backup that should be kept is damaged.
  - Verification is basic (manifest present, counts, paths, sizes, readable). It is not a checksum scan of every file.
  - Encryption: it checks FileVault and the destination drive. A drive that reports "not encrypted" is refused unless you accepted that in setup. The Bridge never formats a drive or stores recovery keys.
- **Restore:** `restore preview` (changes nothing), `--new-vault <folder>`, or `--merge` into the current vault (safety backup first; adds missing files; skips identical ones; for files that differ, Keep Both / Keep Current / Restore Backup Version, and the last needs explicit confirmation). Keep Both does not rewrite links inside notes.

## Cost and limits (checked 2026-11-11 against Cloudflare docs)
Workers Free 100,000 requests/day and 10 ms CPU; D1 Free 5 M rows read and 100 k rows written per day, 500 MB per database, 2 MB per row, 100 KB per statement, 100 bound parameters, Time Travel 7 days. Since 2026-09-01 D1 **fails queries** (it does not just warn) once a daily read/write limit is reached.
- **Polling:** the Mac polls every 15 s: about **5,760 requests/day**, roughly 6% of the Workers allowance, **before** your portfolio, LifeOS and MCP traffic (not measured; check the Cloudflare dashboard before enabling). A poll is a handful of indexed reads and writes nothing when empty; the device "last seen" time is written at most every 5 minutes. When offline the Bridge backs off up to about 5 minutes and checks again right after wake.
- A first sync of ~250 notes is roughly 300 requests and about 2,000 row writes (chunks plus search index). A normal day is tens of requests.
- Storage: roughly 10–40 MB for ~250 notes and ~30 PDFs (text plus index, about 2–3× the text). The limit is 500 MB.
- **Worker bundle** (`wrangler deploy --dry-run`, measured after this work): **1,690 KiB gzip** (8.4 MB uncompressed) against the ~3 MB budget (the earlier baseline was ~1.55 MB). The Node Bridge, PDF reader and Swift app are not in the bundle.
- If a quota error happens the Bridge keeps local files, does not report success, and retries with backoff. It works fully locally when Cloudflare is unreachable.
- No R2, no external AI, no OCR service, no new paid service.

## Using it from Claude
Tools on the existing MCP server: `search_obsidian_knowledge`, `read_obsidian_note`, `read_obsidian_pdf`, `obsidian_status` (reads, work when the Mac is off) and `propose_create_note`, `propose_edit_note`, `propose_rename_note`, `propose_move_note`, `propose_delete_note`, `propose_create_folder`, `propose_rename_folder`, `propose_move_folder`, `propose_delete_folder` (create approval requests only). Reads return the document id, title, source path, an `obsidian://` link, tags, update time, page or section, and say when text was truncated. The tool descriptions tell Claude to cite the source, to say "not found in the synced notes" rather than "no note exists", and never to present a partial read as the whole document.
**Not yet checked with the real Claude mobile app**: that needs a deploy.

## Putting it live
Only you can do these; I did none of them.
1. In LifeOS Settings click **Back up now**.
2. Run `npm run db:migrate:remote` (migration `0013_obsidian_integration.sql`, additive) and check it with the usual status command.
3. Set the Worker secret: `wrangler secret put OBSIDIAN_PAYLOAD_KEY` with 32 random bytes in base64 (for example `openssl rand -base64 32`). Without it reads work but `propose_*` refuses.
4. Look at your Cloudflare dashboard for current daily request and D1 usage.
5. Push to `main` when you have reviewed everything (Workers Builds deploys).
6. On the Mac: `tools/obsidian-bridge/scripts/build.sh`, `build-app.sh`, open the app (first time: right-click → Open), run the Setup Wizard, pair with the code from Settings → Obsidian, review the preview, confirm.

## Mac setup and permissions
- Needs Node 22.5+ and the Xcode Command Line Tools (`swiftc`). Full Xcode is not needed. The app is ad-hoc signed and not notarized.
- macOS may ask to let Node (the Bridge service) access your vault and backup folders, especially under Desktop or Documents. Allow it, or add Node under System Settings → Privacy & Security → Files and Folders / Full Disk Access. If the Bridge reports "Operation not permitted", this is the cause.
- The login item is a user LaunchAgent (`~/Library/LaunchAgents/com.jameswebpupu.obsidian-bridge.plist`), installed only when you confirm. No root, no shell-config changes.

## Command line
`obsidian-bridge setup | status | doctor | sync | pause | resume | backup [list] | restore preview|--new-vault|--merge | logs | pair | unpair | reenable <id> | run | version`, each with `help <command>`. The menu bar app and the CLI both use the same service.

## Troubleshooting
| Symptom | What to check |
|---|---|
| "Operation not permitted" | macOS folder permission for Node (see above); then restart the service. |
| Menu says "Bridge is not running" | Start it from the menu, or `obsidian-bridge run`; check `obsidian-bridge logs`. |
| "This Mac was revoked in LifeOS" | You revoked or unpaired it. `obsidian-bridge pair` with a new code. |
| A note isn't found by Claude | It needs `lifeos_sync: true`, a valid unique `id`, no secret finding, and not revoked. `obsidian-bridge status` and Settings → Obsidian show counts held back. |
| Note shown as "held back: secret" | Open Settings → Obsidian → Secret warnings. Fix the note, or approve that finding. |
| A PDF shows "no text" | It is image-only. OCR is not supported. |
| An approval says "Needs a look" | The note changed after you approved (conflict), the backup failed, or it expired. Ask Claude again. |
| Edits/deletes are refused | The local backup folder isn't writable or isn't set. Run `obsidian-bridge doctor`. |
| Search says it is being rebuilt | After a restore. Run Reconcile (`POST /api/obsidian/reconcile`). |
| Cloudflare quota errors | The Bridge retries with backoff. Check usage; the poll interval can be raised in `config.json` (`pollSeconds`). |

## Uninstall
`tools/obsidian-bridge/scripts/uninstall.sh` stops the Bridge and removes the login item. `obsidian-bridge unpair` also tells LifeOS to forget the Mac and deletes the Keychain token. Delete `~/Library/Application Support/ObsidianBridge` for settings and logs. Your vault and your backups are never removed by any of this. In LifeOS, revoke notes you no longer want copied.

## Known limitations
- No OCR. Image-only PDFs have no text. Images are never synced.
- The secret scanner is not perfect; it can miss secrets and flag harmless text.
- Thai and Japanese search is substring based; very short queries are slower and partial.
- D1 Time Travel history (up to 7 days) cannot be purged on demand.
- Payloads are encrypted in D1 but not end-to-end.
- Local-only file counts for a folder are not shown before approving a delete (see above).
- One vault, one active Mac in the UI (the data model allows more).
- Links inside notes are not rewritten when a note or folder is renamed, moved or restored as "keep both".
- The menu bar app and the Setup Wizard have been compiled and launched, but their screens were not looked at or clicked through by me, and the real Keychain, LaunchAgent, external drive and Claude mobile paths have not been exercised. LifeOS Settings and Approvals screens were not checked at 390 px or in dark mode.
- The Bridge's own tests are not in CI yet.

## Tests
- Website: `npm run check` (typecheck, lint, tests, build), 334 tests at the time of writing, including the Bridge talking to the real Worker routes and Claude's MCP tools end to end.
- Bridge: `cd tools/obsidian-bridge/core && npm test` (124 tests), `npm run typecheck`.
- Mac app: `swift build -c release` in `tools/obsidian-bridge/macos`; a test starts the real service and reads its status through the app's socket client.
