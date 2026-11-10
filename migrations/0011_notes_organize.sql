-- Notes: folders (a folder is a category of kind 'note'), tags, and links to tasks, events and goals.
ALTER TABLE notes ADD COLUMN folder_id TEXT;            -- categories.id with kind 'note' (checked in code)

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag     TEXT NOT NULL,                                -- lower-case, no leading '#'
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

-- Links from a note to a task or an event. (Links between a note and a goal live in goal_links,
-- so a goal shows its notes and a note shows its goals from the same rows.)
CREATE TABLE IF NOT EXISTS note_links (
  note_id     TEXT NOT NULL,
  entity_type TEXT NOT NULL,                            -- task | event
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (note_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_note_links_entity ON note_links(entity_type, entity_id);

-- the old single "event this note belongs to" becomes a link
INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, created_at)
  SELECT id, 'event', event_id, updated_at FROM notes WHERE event_id IS NOT NULL;
