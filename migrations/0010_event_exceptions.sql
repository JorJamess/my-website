-- One row per occurrence of a repeating event that has been taken out of the series
-- ("delete just this one", or "edit just this one", which also creates a separate one-off event).
CREATE TABLE IF NOT EXISTS event_exceptions (
  event_id   TEXT NOT NULL,           -- events.id of the repeating series
  day        TEXT NOT NULL,           -- YYYY-MM-DD (Thailand date) of the skipped occurrence
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, day)
);
CREATE INDEX IF NOT EXISTS idx_event_exceptions_day ON event_exceptions(day);
