import "server-only";
import type { CalendarEvent, EventColor, Note, Summary } from "@/lib/types";
import type {
  EventCreateInput,
  EventUpdateInput,
  NoteCreateInput,
  NoteUpdateInput,
} from "@/lib/schemas";
import { addDaysKey, isValidDate, localDateKey, parseLocal, TZ_OFFSET } from "@/lib/time";
import { getEnv } from "./env";

export class InputError extends Error {}

type EventRow = Omit<CalendarEvent, "all_day" | "done" | "color"> & {
  all_day: number;
  done: number;
  color: string;
};
type NoteRow = Omit<Note, "pinned"> & { pinned: number };

const toEvent = (r: EventRow): CalendarEvent => ({
  ...r,
  all_day: !!r.all_day,
  done: !!r.done,
  color: r.color as EventColor,
});
const toNote = (r: NoteRow): Note => ({ ...r, pinned: !!r.pinned });

async function ctx() {
  const env = await getEnv();
  return { db: env.DB, tz: TZ_OFFSET };
}

function parseOrThrow(value: string, tz: string, field: string) {
  const d = parseLocal(value, tz);
  if (!isValidDate(d)) throw new InputError(`Invalid date or time for ${field}: "${value}"`);
  return d;
}

/** คำนวณ start/end (UTC ISO) จาก input; งานทั้งวัน end เป็นแบบ exclusive (00:00 ของวันถัดไป) */
function resolveTimes(
  start: string,
  end: string | null | undefined,
  allDay: boolean,
  tz: string,
): { start_at: string; end_at: string | null } {
  if (allDay) {
    const startKey = localDateKey(parseOrThrow(start, tz, "start"), tz);
    const lastKey = end ? localDateKey(parseOrThrow(end, tz, "end"), tz) : startKey;
    const endKey = addDaysKey(lastKey < startKey ? startKey : lastKey, 1);
    return {
      start_at: parseLocal(startKey, tz).toISOString(),
      end_at: parseLocal(endKey, tz).toISOString(),
    };
  }
  const s = parseOrThrow(start, tz, "start");
  const e = end ? parseOrThrow(end, tz, "end") : null;
  if (e && e < s) throw new InputError("End time can't be before the start time");
  return { start_at: s.toISOString(), end_at: e ? e.toISOString() : null };
}

/* ----------------------------- Events ----------------------------- */

export async function listEvents(opts: {
  from: string;
  to: string;
  q?: string;
  includeDone?: boolean;
}): Promise<CalendarEvent[]> {
  const { db, tz } = await ctx();
  const from = parseOrThrow(opts.from, tz, "from").toISOString();
  const to = parseOrThrow(opts.to, tz, "to").toISOString();
  let sql =
    "SELECT * FROM events WHERE start_at < ?1 AND COALESCE(end_at, start_at) >= ?2";
  const binds: unknown[] = [to, from];
  if (opts.q) {
    sql += " AND (title LIKE ?3 OR description LIKE ?3 OR location LIKE ?3)";
    binds.push(`%${opts.q}%`);
  }
  if (opts.includeDone === false) sql += " AND done = 0";
  sql += " ORDER BY start_at ASC LIMIT 1000";
  const { results } = await db.prepare(sql).bind(...binds).all<EventRow>();
  return results.map(toEvent);
}

export async function searchEvents(q: string, limit = 50): Promise<CalendarEvent[]> {
  const { db } = await ctx();
  const { results } = await db
    .prepare(
      "SELECT * FROM events WHERE title LIKE ?1 OR description LIKE ?1 OR location LIKE ?1 ORDER BY start_at DESC LIMIT ?2",
    )
    .bind(`%${q}%`, limit)
    .all<EventRow>();
  return results.map(toEvent);
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  return row ? toEvent(row) : null;
}

export async function createEvent(input: EventCreateInput): Promise<CalendarEvent> {
  const { db, tz } = await ctx();
  const allDay = input.all_day ?? false;
  const { start_at, end_at } = resolveTimes(input.start, input.end, allDay, tz);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO events (id, title, description, location, start_at, end_at, all_day, color, done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      input.title.trim(),
      input.description?.trim() || null,
      input.location?.trim() || null,
      start_at,
      end_at,
      allDay ? 1 : 0,
      input.color ?? "blue",
      now,
      now,
    )
    .run();
  return (await getEvent(id))!;
}

export async function updateEvent(id: string, input: EventUpdateInput): Promise<CalendarEvent | null> {
  const { db, tz } = await ctx();
  const current = await getEvent(id);
  if (!current) return null;

  const allDay = input.all_day ?? current.all_day;
  let start_at = current.start_at;
  let end_at = current.end_at;
  if (input.start !== undefined || input.end !== undefined || input.all_day !== undefined) {
    const startStr = input.start ?? current.start_at;
    let endStr: string | null;
    if (input.end !== undefined) endStr = input.end;
    else if (current.end_at) {
      // ไม่ได้ส่ง end มา → คงระยะเวลาเดิมไว้ (เลื่อนตาม start)
      const duration = new Date(current.end_at).getTime() - new Date(current.start_at).getTime();
      const newStart = parseOrThrow(startStr, tz, "start").getTime();
      // งานทั้งวันเก็บ end แบบ exclusive → ลบ 1ms ให้เป็นวันสุดท้าย
      const lastMs = newStart + duration - (current.all_day ? 1 : 0);
      endStr = current.all_day && !allDay ? null : new Date(lastMs).toISOString();
    } else endStr = null;
    ({ start_at, end_at } = resolveTimes(startStr, endStr, allDay, tz));
  }

  const next = {
    title: input.title?.trim() ?? current.title,
    description:
      input.description === undefined ? current.description : input.description?.trim() || null,
    location: input.location === undefined ? current.location : input.location?.trim() || null,
    color: input.color ?? current.color,
    done: input.done ?? current.done,
  };
  await db
    .prepare(
      `UPDATE events SET title=?, description=?, location=?, start_at=?, end_at=?, all_day=?, color=?, done=?, updated_at=? WHERE id=?`,
    )
    .bind(
      next.title,
      next.description,
      next.location,
      start_at,
      end_at,
      allDay ? 1 : 0,
      next.color,
      next.done ? 1 : 0,
      new Date().toISOString(),
      id,
    )
    .run();
  return getEvent(id);
}

export async function deleteEvent(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("UPDATE notes SET event_id = NULL WHERE event_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

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
  const r = await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ----------------------------- Summary ----------------------------- */

export async function getSummary(days = 7): Promise<Summary> {
  const { db, tz } = await ctx();
  const today = localDateKey(new Date(), tz);
  const todayStart = parseLocal(today, tz).toISOString();
  const tomorrowStart = parseLocal(addDaysKey(today, 1), tz).toISOString();
  const upcomingEnd = parseLocal(addDaysKey(today, days + 1), tz).toISOString();

  // สัปดาห์เริ่มวันจันทร์
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStartKey = addDaysKey(today, -((dow + 6) % 7));
  const weekStart = parseLocal(weekStartKey, tz).toISOString();
  const weekEnd = parseLocal(addDaysKey(weekStartKey, 7), tz).toISOString();
  const monthStartKey = `${today.slice(0, 8)}01`;
  const [y, m] = today.split("-").map(Number);
  const nextMonthKey = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const monthStart = parseLocal(monthStartKey, tz).toISOString();
  const monthEnd = parseLocal(nextMonthKey, tz).toISOString();

  const overlap = "start_at < ?1 AND COALESCE(end_at, start_at) >= ?2";
  const [todayRes, upRes, overdueRes, notesRes, counts] = await db.batch([
    db.prepare(`SELECT * FROM events WHERE ${overlap} ORDER BY all_day DESC, start_at ASC`).bind(tomorrowStart, todayStart),
    db.prepare(`SELECT * FROM events WHERE start_at >= ?1 AND start_at < ?2 ORDER BY start_at ASC LIMIT 50`).bind(tomorrowStart, upcomingEnd),
    db.prepare(`SELECT * FROM events WHERE done = 0 AND COALESCE(end_at, start_at) < ?1 AND start_at >= ?2 ORDER BY start_at DESC LIMIT 20`).bind(todayStart, parseLocal(addDaysKey(today, -30), tz).toISOString()),
    db.prepare(`SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 5`),
    db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM events WHERE start_at < ?1 AND COALESCE(end_at, start_at) >= ?2) AS thisWeek,
        (SELECT COUNT(*) FROM events WHERE start_at < ?1 AND COALESCE(end_at, start_at) >= ?2 AND done = 1) AS doneThisWeek,
        (SELECT COUNT(*) FROM events WHERE start_at < ?3 AND COALESCE(end_at, start_at) >= ?4) AS thisMonth,
        (SELECT COUNT(*) FROM notes) AS notes`,
    ).bind(weekEnd, weekStart, monthEnd, monthStart),
  ]);

  const c = (counts.results[0] ?? {}) as Record<string, number>;
  return {
    today,
    todayEvents: (todayRes.results as EventRow[]).map(toEvent),
    upcoming: (upRes.results as EventRow[]).map(toEvent),
    overdue: (overdueRes.results as EventRow[]).map(toEvent),
    recentNotes: (notesRes.results as NoteRow[]).map(toNote),
    counts: {
      thisWeek: c.thisWeek ?? 0,
      thisMonth: c.thisMonth ?? 0,
      doneThisWeek: c.doneThisWeek ?? 0,
      notes: c.notes ?? 0,
    },
  };
}
