-- Recurring events: weekly on chosen weekdays ("1,3,5" = Mon, Wed, Fri; 0 = Sunday).
-- The row is the first occurrence; later ones are generated when listing.
ALTER TABLE events ADD COLUMN repeat_days TEXT;
ALTER TABLE events ADD COLUMN repeat_until TEXT; -- YYYY-MM-DD, last day a repeat may happen (inclusive); NULL = forever

-- To-do / Inbox: tasks that don't need a fixed time.
CREATE TABLE IF NOT EXISTS todos (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  note       TEXT,
  due_date   TEXT,             -- YYYY-MM-DD (Thailand date), optional
  important  INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done, due_date);
