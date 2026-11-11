-- Claude's risky changes wait here for a yes or no, and every change Claude makes is logged.
CREATE TABLE IF NOT EXISTS pending_actions (
  id         TEXT PRIMARY KEY,
  tool       TEXT NOT NULL,                 -- MCP tool name, e.g. delete_note
  args       TEXT NOT NULL,                 -- JSON arguments, already validated
  summary    TEXT NOT NULL,                 -- plain-English description shown to the owner
  risk       TEXT NOT NULL,                 -- delete | edit | link
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | failed | expired
  note       TEXT,                          -- error message when failed
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,                 -- claude | you
  action     TEXT NOT NULL,                 -- tool name, or approve / reject
  summary    TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 1,
  pending_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
