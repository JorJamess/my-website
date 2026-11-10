-- Tasks upgrade: priority, status, category and one level of subtasks.
-- `important` and `done` stay and are kept in sync (important = priority 3, done = status 'done'),
-- so older code keeps working and a rollback loses nothing.
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'gray',
  kind       TEXT NOT NULL DEFAULT 'task',   -- task now; goals and notes can share this table later
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_kind_name ON categories(kind, name);

ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo';      -- todo | doing | done
ALTER TABLE todos ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;      -- 0 none, 1 low, 2 medium, 3 high
ALTER TABLE todos ADD COLUMN category_id TEXT;                          -- categories.id (checked in code)
ALTER TABLE todos ADD COLUMN parent_id TEXT;                            -- todos.id of the parent (subtasks are one level deep)

UPDATE todos SET priority = 3 WHERE important = 1;
UPDATE todos SET status = 'done' WHERE done = 1;
CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);
