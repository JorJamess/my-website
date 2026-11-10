import "server-only";
import type { Note } from "@/lib/types";
import type { NoteCreateInput, NoteUpdateInput } from "@/lib/schemas";
import { ctx, InputError } from "../core";
import { getEvent } from "../events/repo";

export type NoteRow = Omit<Note, "pinned"> & { pinned: number };
export const toNote = (r: NoteRow): Note => ({ ...r, pinned: !!r.pinned });

/* ----------------------------- Notes ----------------------------- */

export async function listNotes(opts: { q?: string; date?: string; eventId?: string; limit?: number } = {}) {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.q) {
    where.push(`(title LIKE ?${binds.length + 1} OR content LIKE ?${binds.length + 1})`);
    binds.push(`%${opts.q}%`);
  }
  if (opts.date) {
    where.push(`note_date = ?${binds.length + 1}`);
    binds.push(opts.date);
  }
  if (opts.eventId) {
    where.push(`event_id = ?${binds.length + 1}`);
    binds.push(opts.eventId);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM notes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY pinned DESC, updated_at DESC LIMIT ${limit}`;
  const { results } = await db.prepare(sql).bind(...binds).all<NoteRow>();
  return results.map(toNote);
}

export async function getNote(id: string): Promise<Note | null> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first<NoteRow>();
  return row ? toNote(row) : null;
}

async function assertEventExists(eventId: string | null | undefined) {
  if (!eventId) return;
  if (!(await getEvent(eventId))) throw new InputError(`No event with id ${eventId}`);
}

export async function createNote(input: NoteCreateInput): Promise<Note> {
  const { db } = await ctx();
  await assertEventExists(input.event_id);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO notes (id, title, content, note_date, event_id, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title.trim(),
      input.content ?? "",
      input.note_date ?? null,
      input.event_id ?? null,
      input.pinned ? 1 : 0,
      now,
      now,
    )
    .run();
  return (await getNote(id))!;
}

export async function updateNote(id: string, input: NoteUpdateInput): Promise<Note | null> {
  const { db } = await ctx();
  const current = await getNote(id);
  if (!current) return null;
  if (input.event_id) await assertEventExists(input.event_id);
  const next = {
    title: input.title?.trim() ?? current.title,
    content: input.content ?? current.content,
    note_date: input.note_date === undefined ? current.note_date : input.note_date,
    event_id: input.event_id === undefined ? current.event_id : input.event_id,
    pinned: input.pinned ?? current.pinned,
  };
  await db
    .prepare(
      `UPDATE notes SET title=?, content=?, note_date=?, event_id=?, pinned=?, updated_at=? WHERE id=?`,
    )
    .bind(
      next.title,
      next.content,
      next.note_date,
      next.event_id,
      next.pinned ? 1 : 0,
      new Date().toISOString(),
      id,
    )
    .run();
  return getNote(id);
}

export async function deleteNote(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("DELETE FROM goal_links WHERE entity_type = 'note' AND entity_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

