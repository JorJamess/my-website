import "server-only";
import type { EventColor, Note, NoteDetail, NoteFolder } from "@/lib/types";
import type { NoteCreateInput, NoteLinkInput, NoteUpdateInput } from "@/lib/schemas";
import { normalizeTag, normalizeTags } from "@/lib/notes";
import { ctx, InputError } from "../core";
import { getEvent } from "../events/repo";
import { categoryIdFor } from "../tasks/repo";

type NoteRow = {
  id: string;
  title: string;
  content: string;
  note_date: string | null;
  event_id: string | null;
  folder_id: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  folder_name?: string | null;
};
export { type NoteRow };

const SELECT = `SELECT n.*, c.name AS folder_name FROM notes n LEFT JOIN categories c ON c.id = n.folder_id`;

export const toNote = (r: NoteRow, tags: string[] = []): Note => ({
  id: r.id,
  title: r.title,
  content: r.content,
  note_date: r.note_date,
  event_id: r.event_id,
  folder: r.folder_id && r.folder_name ? { id: r.folder_id, name: r.folder_name } : null,
  tags,
  pinned: !!r.pinned,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

async function tagsByNote(): Promise<Map<string, string[]>> {
  const { db } = await ctx();
  const { results } = await db.prepare("SELECT note_id, tag FROM note_tags ORDER BY tag").all<{ note_id: string; tag: string }>();
  const map = new Map<string, string[]>();
  for (const r of results) map.set(r.note_id, [...(map.get(r.note_id) ?? []), r.tag]);
  return map;
}

/* ----------------------------- Notes ----------------------------- */

export async function listNotes(
  opts: { q?: string; date?: string; eventId?: string; folder?: string; tag?: string; pinned?: boolean; limit?: number } = {},
) {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  const bind = (v: unknown) => `?${binds.push(v)}`;
  if (opts.q) {
    const like = bind(`%${opts.q}%`);
    where.push(`(n.title LIKE ${like} OR n.content LIKE ${like} OR EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag LIKE ${like}))`);
  }
  if (opts.date) where.push(`n.note_date = ${bind(opts.date)}`);
  if (opts.eventId) where.push(`EXISTS (SELECT 1 FROM note_links l WHERE l.note_id = n.id AND l.entity_type = 'event' AND l.entity_id = ${bind(opts.eventId)})`);
  if (opts.folder === "none") where.push("n.folder_id IS NULL");
  else if (opts.folder) where.push(`(n.folder_id = ${bind(opts.folder)} OR c.name = ?${binds.push(opts.folder)} COLLATE NOCASE)`);
  if (opts.tag) where.push(`EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag = ${bind(normalizeTag(opts.tag))})`);
  if (opts.pinned) where.push("n.pinned = 1");
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ${limit}`;
  const [{ results }, tags] = await Promise.all([db.prepare(sql).bind(...binds).all<NoteRow>(), tagsByNote()]);
  return results.map((r) => toNote(r, tags.get(r.id) ?? []));
}

export async function getNote(id: string): Promise<Note | null> {
  const { db } = await ctx();
  const row = await db.prepare(`${SELECT} WHERE n.id = ?`).bind(id).first<NoteRow>();
  if (!row) return null;
  const { results } = await db.prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag").bind(id).all<{ tag: string }>();
  return toNote(row, results.map((t) => t.tag));
}

/** A note with the tasks, events and goals it is linked to. */
export async function getNoteDetail(id: string): Promise<NoteDetail | null> {
  const { db } = await ctx();
  const note = await getNote(id);
  if (!note) return null;
  const [tasks, events, goals] = await Promise.all([
    db
      .prepare("SELECT t.id, t.title, t.done FROM note_links l JOIN todos t ON t.id = l.entity_id WHERE l.note_id = ? AND l.entity_type = 'task' ORDER BY l.created_at")
      .bind(id)
      .all<{ id: string; title: string; done: number }>(),
    db
      .prepare("SELECT e.id, e.title, e.start_at, e.all_day, e.color FROM note_links l JOIN events e ON e.id = l.entity_id WHERE l.note_id = ? AND l.entity_type = 'event' ORDER BY l.created_at")
      .bind(id)
      .all<{ id: string; title: string; start_at: string; all_day: number; color: string }>(),
    db
      .prepare("SELECT g.id, g.title, g.color FROM goal_links l JOIN goals g ON g.id = l.goal_id WHERE l.entity_type = 'note' AND l.entity_id = ? ORDER BY l.created_at")
      .bind(id)
      .all<{ id: string; title: string; color: string }>(),
  ]);
  return {
    ...note,
    links: {
      tasks: tasks.results.map((t) => ({ ...t, done: !!t.done })),
      events: events.results.map((e) => ({ id: e.id, title: e.title, start_at: e.start_at, all_day: !!e.all_day, color: e.color as EventColor })),
      goals: goals.results.map((g) => ({ id: g.id, title: g.title, color: g.color as EventColor })),
    },
  };
}

async function setTags(noteId: string, raw: readonly string[]) {
  const { db } = await ctx();
  const tags = normalizeTags(raw);
  await db.batch([
    db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId),
    ...tags.map((t) => db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)").bind(noteId, t)),
  ]);
}

/** keeps the old notes.event_id column pointing at the first linked event, so nothing older breaks */
async function syncEventColumn(noteId: string) {
  const { db } = await ctx();
  await db
    .prepare("UPDATE notes SET event_id = (SELECT entity_id FROM note_links WHERE note_id = ?1 AND entity_type = 'event' ORDER BY created_at LIMIT 1) WHERE id = ?1")
    .bind(noteId)
    .run();
}

export async function createNote(input: NoteCreateInput): Promise<Note> {
  const { db } = await ctx();
  if (input.event_id && !(await getEvent(input.event_id))) throw new InputError(`No event with id ${input.event_id}`);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const folderId = input.folder ? await categoryIdFor(input.folder, "note") : null;
  await db
    .prepare(
      `INSERT INTO notes (id, title, content, note_date, event_id, folder_id, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.title.trim(), input.content ?? "", input.note_date ?? null, input.event_id ?? null, folderId, input.pinned ? 1 : 0, now, now)
    .run();
  if (input.tags?.length) await setTags(id, input.tags);
  if (input.event_id) {
    await db.prepare("INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, created_at) VALUES (?, 'event', ?, ?)").bind(id, input.event_id, now).run();
  }
  return (await getNote(id))!;
}

export async function updateNote(id: string, input: NoteUpdateInput): Promise<Note | null> {
  const { db } = await ctx();
  const current = await getNote(id);
  if (!current) return null;
  if (input.event_id && !(await getEvent(input.event_id))) throw new InputError(`No event with id ${input.event_id}`);
  const next = {
    title: input.title?.trim() ?? current.title,
    content: input.content ?? current.content,
    note_date: input.note_date === undefined ? current.note_date : input.note_date,
    pinned: input.pinned ?? current.pinned,
    folder_id: input.folder === undefined ? (current.folder?.id ?? null) : input.folder === null ? null : await categoryIdFor(input.folder, "note"),
  };
  await db
    .prepare(`UPDATE notes SET title=?, content=?, note_date=?, folder_id=?, pinned=?, updated_at=? WHERE id=?`)
    .bind(next.title, next.content, next.note_date, next.folder_id, next.pinned ? 1 : 0, new Date().toISOString(), id)
    .run();
  if (input.tags) await setTags(id, input.tags);
  if (input.event_id !== undefined) {
    // the old single-event field: null clears every event link, an id makes that the only one
    await db.prepare("DELETE FROM note_links WHERE note_id = ? AND entity_type = 'event'").bind(id).run();
    if (input.event_id) {
      await db.prepare("INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, created_at) VALUES (?, 'event', ?, ?)").bind(id, input.event_id, new Date().toISOString()).run();
    }
    await syncEventColumn(id);
  }
  return getNote(id);
}

export async function deleteNote(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("DELETE FROM goal_links WHERE entity_type = 'note' AND entity_id = ?").bind(id).run();
  await db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(id).run();
  await db.prepare("DELETE FROM note_links WHERE note_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ------------------------------- Tags ------------------------------- */

export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const { db } = await ctx();
  const { results } = await db.prepare("SELECT tag, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY count DESC, tag ASC").all<{ tag: string; count: number }>();
  return results;
}

/* ------------------------------ Folders ------------------------------ */

export async function listFolders(): Promise<NoteFolder[]> {
  const { db } = await ctx();
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = c.id) AS count
       FROM categories c WHERE c.kind = 'note' ORDER BY c.name COLLATE NOCASE`,
    )
    .all<NoteFolder>();
  return results;
}

export async function createFolder(name: string): Promise<NoteFolder> {
  const id = await categoryIdFor(name, "note");
  return (await listFolders()).find((f) => f.id === id)!;
}

export async function renameFolder(id: string, name: string): Promise<NoteFolder | null> {
  const { db } = await ctx();
  const clean = name.trim();
  if (!clean) throw new InputError("Folder name can't be empty");
  const cur = await db.prepare("SELECT id FROM categories WHERE id = ? AND kind = 'note'").bind(id).first();
  if (!cur) return null;
  const clash = await db.prepare("SELECT id FROM categories WHERE kind = 'note' AND name = ?1 COLLATE NOCASE AND id <> ?2").bind(clean, id).first();
  if (clash) throw new InputError(`There is already a folder called "${clean}"`);
  await db.prepare("UPDATE categories SET name = ? WHERE id = ?").bind(clean, id).run();
  return (await listFolders()).find((f) => f.id === id) ?? null;
}

/** Removes the folder; its notes stay, just without a folder. */
export async function deleteFolder(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("UPDATE notes SET folder_id = NULL WHERE folder_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM categories WHERE id = ? AND kind = 'note'").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ------------------------------- Links ------------------------------- */

async function entityExists(type: NoteLinkInput["entity_type"], id: string) {
  const { db } = await ctx();
  switch (type) {
    case "task":
      return !!(await db.prepare("SELECT 1 AS x FROM todos WHERE id = ?").bind(id).first());
    case "goal":
      return !!(await db.prepare("SELECT 1 AS x FROM goals WHERE id = ?").bind(id).first());
    case "event":
      return !!(await getEvent(id));
  }
}

/** Link a note to a task, event or goal. Linking twice is harmless. */
export async function linkNote(noteId: string, input: NoteLinkInput): Promise<void> {
  const { db } = await ctx();
  if (!(await getNote(noteId))) throw new InputError(`No note with id ${noteId}`);
  if (!(await entityExists(input.entity_type, input.entity_id))) throw new InputError(`No ${input.entity_type} with id ${input.entity_id}`);
  const now = new Date().toISOString();
  if (input.entity_type === "goal") {
    await db.prepare("INSERT OR IGNORE INTO goal_links (goal_id, entity_type, entity_id, created_at) VALUES (?, 'note', ?, ?)").bind(input.entity_id, noteId, now).run();
  } else {
    await db.prepare("INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)").bind(noteId, input.entity_type, input.entity_id, now).run();
    if (input.entity_type === "event") await syncEventColumn(noteId);
  }
}

export async function unlinkNote(noteId: string, input: NoteLinkInput): Promise<boolean> {
  const { db } = await ctx();
  const r =
    input.entity_type === "goal"
      ? await db.prepare("DELETE FROM goal_links WHERE goal_id = ? AND entity_type = 'note' AND entity_id = ?").bind(input.entity_id, noteId).run()
      : await db.prepare("DELETE FROM note_links WHERE note_id = ? AND entity_type = ? AND entity_id = ?").bind(noteId, input.entity_type, input.entity_id).run();
  if (input.entity_type === "event") await syncEventColumn(noteId);
  return (r.meta.changes ?? 0) > 0;
}
