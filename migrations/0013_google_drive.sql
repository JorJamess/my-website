-- Google Drive connection for the Library page. One row only (id = 1).
-- The refresh token is stored encrypted (AES-GCM, key derived from SESSION_SECRET); the files stay in Drive.
CREATE TABLE IF NOT EXISTS google_drive_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,             -- iv.ciphertext, base64url
  scope         TEXT NOT NULL,
  folder_id     TEXT,                      -- the Drive folder the Library is limited to
  folder_name   TEXT,
  connected_at  TEXT NOT NULL
);
