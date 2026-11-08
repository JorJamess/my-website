-- ข้อความจากฟอร์มติดต่อบนหน้า Portfolio
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT 'other',  -- internship | freelance | other
  body        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  read        INTEGER NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages(ip, created_at);
