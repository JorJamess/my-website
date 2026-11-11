# ADR 0002: Obsidian Bridge

Date: 2026-11-11. Status: **accepted** (owner approved 2026-11-11) and implemented. The practical guide is `docs/obsidian-integration.md`; this file keeps the reasons.

## Context
Obsidian ("James Knowledge") stays the source of truth for personal knowledge. Claude on claude.ai and mobile should be able to search and read notes the owner chose to share, and propose changes, even while the Mac is off. Every remote change needs the owner's approval. Constraints: existing Cloudflare Workers + D1 + KV only, no new paid service, no deploy or production change without the owner.

## Audit findings that shape the design
- `pending_actions` (migration 0012) has no `approved_at`, `expires_at`, device, payload or hash columns, and `risk` is only `delete | edit | link`. `gate.ts` approves by running the tool inside the Worker at once. Obsidian actions run later on the Mac, so they need their own states and path. Existing approvals stay untouched.
- `api()` requires the owner cookie, so it cannot serve the Bridge. A separate `deviceApi()` checks a device token; `api()` is not changed.
- `BACKUP_TABLES` dumps whole tables to KV. Content tables must stay out of it; only control tables go in.
- Latest migration is 0012, so ours start at 0013.
- FTS5 with the `trigram` tokenizer works in local workerd D1 (the same engine as production): Thai without spaces and Japanese substrings match, queries under 3 characters do not, so a bounded `LIKE` fallback is needed.
- This Mac has Swift 6.1 (Command Line Tools) but no full Xcode. The menu bar app is built as a Swift package and wrapped into an `.app`. Signing/notarization would need Xcode.

## Cloudflare limits (checked 2026-11-11 against the docs)
Workers Free: 100,000 requests/day, 10 ms CPU. D1 Free: 5M rows read/day, 100k rows written/day, 500 MB per database, 5 GB per account, 2 MB max row, 100 KB per SQL statement, 100 bound parameters per query, 7-day Time Travel. Since 2026-09-01 D1 **fails queries** on Free once the daily read/write limit is reached, so quota errors must be handled, not just warned about. Worker size is quoted inconsistently in the docs (3 MB vs 64 MiB); we keep to the 3 MB gzip budget.

### Usage estimate
| Item | Estimate |
|---|---|
| Bridge polling, 15 s, 24 h | 5,760 requests/day (~5.8% of 100k) |
| Heartbeat piggybacked on the poll | 0 extra |
| Poll query | one indexed read, no write when empty |
| Initial sync, 250 notes | ~300 requests, ~2,000 row writes (chunks + FTS) |
| Normal day of edits | tens of requests |
| Existing LifeOS/portfolio/MCP traffic | **not yet measured**; read from the Cloudflare dashboard before enabling polling |
| Storage, 250 notes + 30 PDFs | roughly 10–40 MB of 500 MB (text plus the FTS index, about 2–3x the text) |

If the account is already near a limit, the poll interval is configurable (default 15 s, as chosen).

## Decisions

### Components
```
Obsidian Vault (local, source of truth)
      │ read / atomic write
 Obsidian Bridge Core (Node/TS, LaunchAgent) ── unix socket ── Menu Bar app (SwiftUI) / CLI
      │ HTTPS, device token (Keychain)
 LifeOS Worker  /api/obsidian/**  ── D1 (docs, chunks, FTS, grants, approvals) ── KV (control backup)
      │ existing /api/mcp
 Claude (web / mobile)
```
Bridge code lives in `tools/obsidian-bridge/` with its own `package.json`; nothing from it is imported by the Worker. Swift app and CLI only talk to the Core over a socket (mode 0600) in the user's Application Support folder. No listening network port.

### Pairing
LifeOS creates a one-time code (8 chars, 10 min, stored hashed). The Bridge posts the code and a generated device public id; the Worker returns a random 256-bit device token **once**. The Worker stores only its SHA-256 hash; the Mac stores the token in Keychain. Every Bridge request carries the token, is checked against a non-revoked device, and failed attempts feed the existing IP limiter. Revoke in LifeOS sets `revoked_at`; the next request fails.

### Selective sync
Only `lifeos_sync: true` notes. Stable identity is frontmatter `id` (UUID); the Bridge inserts it by editing just that line, never rewriting the file. Wiki-links to unshared notes stay as text. Images become `[Image attachment: name — not synchronized]`. PDFs referenced from shared notes (`![[x.pdf]]`, `[[x.pdf]]`, `[t](./x.pdf)`) are extracted locally (PDFKit via a small Swift helper, with the Node core calling it; Thai/English/Japanese tested), max 100 MB, chunked to about 4 KB, page number kept. No OCR; scanned PDFs get `no_text`.

### Secret scanning
Rules-based scanner (known key formats, private key blocks, password assignments, entropy heuristic) runs on the Mac before every upload and before every Claude-created file, and again on the Worker before queueing a proposal. A hit blocks cloud sync for that note only (`blocked_secret`). Exceptions are per finding and bound to the content hash; any edit invalidates them. It is a safety net, not a guarantee.

### Data model (migration 0013, additive)
`obsidian_devices`, `obsidian_pairing_codes`, `obsidian_documents` (uuid, title, path, hash, type, tags, status, sync_version, grant_version), `obsidian_chunks`, `obsidian_pdf_documents`, `obsidian_sync_state`, `obsidian_revocations` (document_id, grant_version, revoked_at, reason, reenabled), `obsidian_commands` (approved Bridge work, see below), `obsidian_fts` (FTS5 trigram, rebuildable). Chunk rows stay far below the 2 MB row limit; inserts are batched under the 100-parameter and 100 KB statement limits.

### Revocation
One batch: bump `grant_version`, delete chunks, FTS rows and PDF text, write the tombstone, write a content-free audit row. Uploads carry the grant version; the Worker rejects anything older than the tombstone, so a stale Mac cannot bring content back. Re-enable needs the owner, a fresh scan on the Mac and a new grant version. Time Travel may retain history up to 7 days; the UI and docs say so and never claim erasure.

### Approvals for vault changes
Claude's nine proposals (create/edit/rename/move/delete note, create/rename/move/delete folder) are validated, scanned, size-checked (1 MB), encrypted and stored as a `pending_actions` row with a new risk `vault`, plus an `obsidian_commands` row holding the encrypted payload, `expected_hash`, `expires_at` and `claimed_by`. `gate.ts` gets one branch that routes these tools to the vault queue instead of running them. On approval the status becomes `approved` and `approved_at` starts the expiry clock (create 30 d, edit/rename/move 7 d, delete 24 h). The Bridge polls one indexed query, claims a command atomically, re-checks expiry, secrets and the file hash, takes a safety backup for anything that changes or removes existing content, applies it atomically, then reports `applied | conflict | failed | expired`. Payloads are deleted after the result. Encryption is AES-256-GCM with a Worker secret (`OBSIDIAN_PAYLOAD_KEY`, which **the owner sets**), a fresh nonce per payload; this is server-side, not end-to-end. Deletes move to the Obsidian trash. Existing paths are never overwritten or auto-renamed.

### MCP
New tools on the existing server: `search_obsidian_knowledge`, `read_obsidian_note`, `read_obsidian_pdf`, `obsidian_status`, and nine `propose_*` tools. Reads return IDs, source paths, page/chunk references, `updated_at` and a truncation flag. Nothing about unshared notes is ever returned; folder previews give only counts by type for unshared files.

### Search
FTS5 trigram for 3+ characters, `LIKE` on a bounded candidate set for shorter queries, Unicode NFC normalised text, excerpt-only results. The index is rebuilt after any restore.

### Cloud backup scope
`BACKUP_TABLES` gains only control tables (devices without token hashes, revocations, grant versions, document id + status). Not included: content, chunks, FTS, PDF text, payloads. After a D1 restore: apply tombstones, purge, rebuild FTS, then re-enable MCP search (a flag in `obsidian_sync_state`).

### Local backup
Per-snapshot content-addressed store (files keyed by size+hash, hard links between snapshots on APFS). Each restore point has a full manifest, so deleting an old snapshot never breaks another. Schedule: daily 02:00 (keep 7), Sunday (keep 4), 1st of month (keep 3), catch-up after sleep, one copy can carry several labels. Basic verification (manifest, counts, sizes, readability) before a destination counts as successful and before any pruning. The local backup must succeed before a destructive vault change. The external SSD is optional, found by volume UUID, reported separately. Restore: preview, restore to a new vault, safe merge into an existing one (after a safety backup; keep both / keep current / restore backup version).

### Phases and review points
Phase 2 (D1 + Worker API + MCP, local only) → Phase 3 (Node core + CLI) → Phase 6 (backup/restore, on fixtures) → Phase 4 (Swift app) → Phase 7 (Settings UI) → Phase 8 (docs, full check). I stop for review after each phase. Nothing is pushed, deployed or migrated remotely by me.

## Open items for the owner
1. Before the feature is usable in production the owner must: back up in LifeOS, run `npm run db:migrate:remote`, set the `OBSIDIAN_PAYLOAD_KEY` secret, then push.
2. Existing traffic must be read from the Cloudflare dashboard to confirm headroom for 5,760 polls/day.
3. Xcode is not installed; see findings.

## As built: where the implementation differs from the plan above
- **Bridge ↔ Worker contract:** the poll returns a `cursor` that lags by one minute (a revocation committed just after a read must not be skipped), the count of proposals awaiting approval, and revocation/re-enable/exception changes. Revoked devices get `device_revoked` and are not counted toward the per-IP lockout; valid tokens are never locked out.
- **Upload safety:** every write is guarded in SQL against a concurrent revoke and re-checked after each batch; multi-part uploads stay invisible until complete and an interrupted re-upload keeps the previous copy searchable.
- **Secret fingerprints** no longer include line numbers, so the Mac's scan of a whole note and the Worker's scan of uploaded chunks agree. The scanner, path rules, chunk sizes, crypto helpers and line diff are shared code: `src/lib/obsidian/*` is the source, copied to the Bridge by `npm run sync-shared`, with tests that fail on drift.
- **Backups** use per-snapshot folders with hard links for unchanged files in daily backups (weekly, monthly and the first are full copies) rather than a separate content-addressed store. Same goal: every restore point is complete on its own.
- **The Menu Bar app** holds no logic. Wizard steps are `obsidian-bridge wizard <step>` (JSON). The Core, not the Swift app, writes the Keychain entry.
- **Claude can only target synced notes and folders that contain a synced note**; other paths look nonexistent.
- **Not done:** showing the count of local-only files in a folder before approving its deletion (only the Mac knows it; it would need an extra Bridge round trip), Bridge tests in CI, and any check on real devices (Claude mobile, external SSD, Keychain/LaunchAgent on the owner's Mac).
