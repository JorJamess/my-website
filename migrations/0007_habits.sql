-- Habits: a repeating thing the owner wants to do, plus one check-in row per day it was done.
-- schedule_type: daily | weekdays (weekdays "1,3,5", 0 = Sunday) | interval (every interval_days days from start_date)
-- Streaks and rates are computed when read, never stored.
CREATE TABLE IF NOT EXISTS habits (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  color         TEXT NOT NULL DEFAULT 'blue',
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  weekdays      TEXT,
  interval_days INTEGER,
  start_date    TEXT NOT NULL,           -- YYYY-MM-DD (Thailand date), first day it counts
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_habits_archived ON habits(archived_at);

CREATE TABLE IF NOT EXISTS habit_checkins (
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,              -- YYYY-MM-DD (Thailand date)
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (habit_id, day)
);
CREATE INDEX IF NOT EXISTS idx_checkins_day ON habit_checkins(day);
