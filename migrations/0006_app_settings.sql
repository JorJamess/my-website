-- Small key/value store for app-level settings.
-- session_version: bump it to log every device out (sessions carry the version they were issued under).
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
