-- Goals, their milestones, and links to the things that serve them.
-- Progress is computed when read (milestones done + linked tasks done), never stored.
CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  horizon      TEXT NOT NULL DEFAULT 'short',    -- short | long
  category_id  TEXT,                              -- categories.id with kind 'goal' (checked in code)
  priority     INTEGER NOT NULL DEFAULT 0,        -- 0 none, 1 low, 2 medium, 3 high
  status       TEXT NOT NULL DEFAULT 'active',    -- active | paused | done | cancelled
  color        TEXT NOT NULL DEFAULT 'blue',
  start_date   TEXT,                              -- YYYY-MM-DD
  target_date  TEXT,                              -- YYYY-MM-DD
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

CREATE TABLE IF NOT EXISTS milestones (
  id         TEXT PRIMARY KEY,
  goal_id    TEXT NOT NULL,                       -- goals.id (milestones are deleted with their goal, in code)
  title      TEXT NOT NULL,
  due_date   TEXT,
  done_at    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_goal ON milestones(goal_id);

-- One table links a goal to tasks, habits, events and notes. No database foreign key on entity_id
-- (it points at four different tables); the service checks it on link and cleans up when an item is deleted.
CREATE TABLE IF NOT EXISTS goal_links (
  goal_id     TEXT NOT NULL,
  entity_type TEXT NOT NULL,                      -- task | habit | event | note
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (goal_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_links_entity ON goal_links(entity_type, entity_id);
