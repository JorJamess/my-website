-- Events: เวลาเก็บเป็น ISO-8601 UTC (เช่น 2026-11-08T07:00:00.000Z)
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  start_at    TEXT NOT NULL,
  end_at      TEXT,
  all_day     INTEGER NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT 'blue',
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  note_date   TEXT,             -- YYYY-MM-DD (วันที่ตามเวลาไทย) ไม่บังคับ
  event_id    TEXT REFERENCES events(id) ON DELETE SET NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(note_date);
