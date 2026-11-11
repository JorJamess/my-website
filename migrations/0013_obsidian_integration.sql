-- Obsidian integration (additive only). See docs/adr/0002-obsidian-bridge.md.
-- Notes and PDF text here are COPIES of what the owner chose to share (lifeos_sync: true); Obsidian stays the source of truth.

-- A paired Mac. Only a SHA-256 hash of the device token is stored.
CREATE TABLE IF NOT EXISTS obsidian_devices (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  vault_name        TEXT,
  token_hash        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  paused            INTEGER NOT NULL DEFAULT 0,      -- owner pressed Pause in LifeOS
  sync_requested_at TEXT,                            -- owner pressed Sync now
  paired_at         TEXT NOT NULL,
  last_seen_at      TEXT,
  revoked_at        TEXT,
  bridge_version    TEXT
);

-- One-time pairing codes (stored hashed, short-lived).
CREATE TABLE IF NOT EXISTS obsidian_pairing_codes (
  code_hash  TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- One row per shared document: a Markdown note (kind = note) or a PDF referenced by one (kind = pdf).
CREATE TABLE IF NOT EXISTS obsidian_documents (
  id              TEXT PRIMARY KEY,                  -- stable UUID from the note's frontmatter (pdf: derived from its content hash)
  kind            TEXT NOT NULL DEFAULT 'note',      -- note | pdf
  title           TEXT NOT NULL,
  path            TEXT NOT NULL,                     -- path inside the vault, only for shared documents
  content_hash    TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]',        -- JSON array
  status          TEXT NOT NULL DEFAULT 'pending',   -- not_synced | pending | syncing | synced | blocked_secret | blocked_revoked | failed | conflict | no_text | deleted
  grant_version   INTEGER NOT NULL DEFAULT 0,
  sync_version    INTEGER NOT NULL DEFAULT 0,        -- last committed upload
  pending_version INTEGER NOT NULL DEFAULT 0,        -- upload in progress
  expected_chunks INTEGER NOT NULL DEFAULT 0,
  char_count      INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  synced_at       TEXT,
  device_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_docs_status ON obsidian_documents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_docs_path ON obsidian_documents(path);

-- Searchable text, bounded chunks. rowid is shared with the FTS index.
CREATE TABLE IF NOT EXISTS obsidian_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL,
  sync_version INTEGER NOT NULL,
  chunk_index  INTEGER NOT NULL,
  page         INTEGER,
  heading      TEXT,
  content      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_chunks_doc ON obsidian_chunks(document_id, sync_version, chunk_index);

-- Rebuildable search index (not backed up; rebuilt after a restore).
CREATE VIRTUAL TABLE IF NOT EXISTS obsidian_fts USING fts5(content, tokenize = 'trigram');

-- Which shared notes reference which PDF (a PDF is removed when no shared note references it).
CREATE TABLE IF NOT EXISTS obsidian_pdf_refs (
  pdf_id  TEXT NOT NULL,
  note_id TEXT NOT NULL,
  PRIMARY KEY (pdf_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_obs_pdf_refs_note ON obsidian_pdf_refs(note_id);

CREATE TABLE IF NOT EXISTS obsidian_pdf_documents (
  document_id TEXT PRIMARY KEY,
  state       TEXT NOT NULL,                         -- pending | processing | completed | no_text | failed | too_large
  size_bytes  INTEGER,
  pages       INTEGER,
  message     TEXT,
  updated_at  TEXT NOT NULL
);

-- Per device sync status shown in LifeOS.
CREATE TABLE IF NOT EXISTS obsidian_sync_state (
  device_id       TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'idle',      -- idle | syncing | paused | error
  last_success_at TEXT,
  last_error      TEXT,
  last_error_at   TEXT,
  details         TEXT NOT NULL DEFAULT '{}',        -- JSON counters from the Bridge (no note names or content)
  updated_at      TEXT NOT NULL
);

-- Durable control data: a revoked document can never be restored by a stale upload.
CREATE TABLE IF NOT EXISTS obsidian_revocations (
  document_id  TEXT PRIMARY KEY,
  grant_version INTEGER NOT NULL,
  state        TEXT NOT NULL,                        -- revoked | reenabled
  reason       TEXT,
  revoked_at   TEXT NOT NULL,
  reenabled_at TEXT,
  changed_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_rev_changed ON obsidian_revocations(changed_at);

-- Secret scanner findings. Values are never stored, only type, position and a fingerprint.
CREATE TABLE IF NOT EXISTS obsidian_findings (
  id           TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  content_hash TEXT NOT NULL,                        -- exceptions only apply to this exact content
  kind         TEXT NOT NULL,
  line         INTEGER,
  redacted     TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',         -- open | excepted
  excepted_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_findings_doc ON obsidian_findings(document_id);
CREATE INDEX IF NOT EXISTS idx_obs_findings_exc ON obsidian_findings(excepted_at);

-- Approved vault changes waiting for the Mac. The proposal text is encrypted (AES-256-GCM) and deleted after use.
CREATE TABLE IF NOT EXISTS obsidian_commands (
  id           TEXT PRIMARY KEY,
  pending_id   TEXT NOT NULL UNIQUE,                 -- the row in pending_actions the owner sees
  op           TEXT NOT NULL,                        -- create_note | edit_note | rename_note | move_note | delete_note | create_folder | rename_folder | move_folder | delete_folder
  status       TEXT NOT NULL DEFAULT 'awaiting_approval', -- awaiting_approval | approved | claimed | applied | conflict | failed | expired | rejected
  payload_enc  TEXT,
  expected_hash TEXT,
  ttl_seconds  INTEGER NOT NULL,
  secret_findings INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,                        -- while awaiting approval: created_at + ttl; once approved: approved_at + ttl
  approved_at  TEXT,
  claimed_at   TEXT,
  claimed_by   TEXT,
  finished_at  TEXT,
  result       TEXT                                  -- short message without note content
);
CREATE INDEX IF NOT EXISTS idx_obs_cmd_poll ON obsidian_commands(status, expires_at);
