import "server-only";
import type { CalendarEvent, EventColor, Note, Summary, Todo } from "@/lib/types";
import type {
  EventCreateInput,
  EventUpdateInput,
  NoteCreateInput,
  NoteUpdateInput,
  TodoCreateInput,
  TodoUpdateInput,
} from "@/lib/schemas";
import { addDaysKey, isValidDate, localDateKey, parseLocal, TZ_OFFSET } from "@/lib/time";
import { expandSeries, parseRepeatDays, serializeRepeatDays } from "@/lib/recurrence";
import { getEnv } from "./env";

export class InputError extends Error {}

type EventRow = Omit<CalendarEvent, "all_day" | "done" | "color" | "repeat_days"> & {
  all_day: number;
  done: number;
  color: string;
  repeat_days: string | null;
};
type TodoRow = Omit<Todo, "important" | "done"> & { important: number; done: number };
type NoteRow = Omit<Note, "pinned"> & { pinned: number };

const toEvent = (r: EventRow): CalendarEvent => ({
  ...r,
  all_day: !!r.all_day,
  done: !!r.done,
  color: r.color as EventColor,
  repeat_days: parseRepeatDays(r.repeat_days),
});
const toTodo = (r: TodoRow): Todo => ({ ...r, important: !!r.important, done: !!r.done });
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

/** Events overlapping [fromISO, toISO), with recurring series expanded into occurrences. */
async function fetchEvents(
  db: D1Database,
  tz: string,
  fromISO: string,
  toISO: string,
  q?: string,
): Promise<CalendarEvent[]> {
  const fromDay = localDateKey(new Date(fromISO), tz);
  let sql = `SELECT * FROM events WHERE (
      (repeat_days IS NULL AND start_at < ?1 AND COALESCE(end_at, start_at) >= ?2)
      OR (repeat_days IS NOT NULL AND start_at < ?1 AND (repeat_until IS NULL OR repeat_until >= ?3)))`;
  const binds: unknown[] = [toISO, fromISO, fromDay];
  if (q) {
    sql += " AND (title LIKE ?4 OR description LIKE ?4 OR location LIKE ?4)";
    binds.push(`%${q}%`);
  }
  sql += " ORDER BY start_at ASC LIMIT 1000";
  const { results } = await db.prepare(sql).bind(...binds).all<EventRow>();
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  return results
    .map(toEvent)
    .flatMap((e) => expandSeries(e, fromMs, toMs))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export async function listEvents(opts: {
  from: string;
  to: string;
  q?: string;
  includeDone?: boolean;
}): Promise<CalendarEvent[]> {
  const { db, tz } = await ctx();
  const from = parseOrThrow(opts.from, tz, "from").toISOString();
  const to = parseOrThrow(opts.to, tz, "to").toISOString();
  const events = await fetchEvents(db, tz, from, to, opts.q);
  return opts.includeDone === false ? events.filter((e) => !e.done) : events;
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
      `INSERT INTO events (id, title, description, location, start_at, end_at, all_day, color, done, repeat_days, repeat_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
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
      serializeRepeatDays(input.repeat_days),
      input.repeat_days?.length ? (input.repeat_until ?? null) : null,
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
    repeat_days: input.repeat_days === undefined ? current.repeat_days : input.repeat_days,
    repeat_until: input.repeat_until === undefined ? current.repeat_until : input.repeat_until,
  };
  if (!next.repeat_days?.length) {
    next.repeat_days = null;
    next.repeat_until = null;
  } else next.done = false; // a repeating series has no single done state
  await db
    .prepare(
      `UPDATE events SET title=?, description=?, location=?, start_at=?, end_at=?, all_day=?, color=?, done=?, repeat_days=?, repeat_until=?, updated_at=? WHERE id=?`,
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
      serializeRepeatDays(next.repeat_days),
      next.repeat_until,
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

  const [monthEvents, upRes, overdueRes, notesRes, todosRes, counts] = await Promise.all([
    fetchEvents(db, tz, monthStart < weekStart ? monthStart : weekStart, monthEnd > weekEnd ? monthEnd : weekEnd),
    fetchEvents(db, tz, tomorrowStart, upcomingEnd),
    db
      .prepare(
        `SELECT * FROM events WHERE done = 0 AND repeat_days IS NULL AND COALESCE(end_at, start_at) < ?1 AND start_at >= ?2 ORDER BY start_at DESC LIMIT 20`,
      )
      .bind(todayStart, parseLocal(addDaysKey(today, -30), tz).toISOString())
      .all<EventRow>(),
    db.prepare(`SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 5`).all<NoteRow>(),
    db
      .prepare(
        `SELECT * FROM todos WHERE done = 0 ORDER BY important DESC, due_date IS NULL, due_date ASC, created_at DESC LIMIT 30`,
      )
      .all<TodoRow>(),
    db
      .prepare(`SELECT (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM todos WHERE done = 0) AS todosOpen`)
      .first<{ notes: number; todosOpen: number }>(),
  ]);

  const overlaps = (e: CalendarEvent, from: string, to: string) =>
    e.start_at < to && (e.end_at ?? e.start_at) >= from;
  const inWeek = monthEvents.filter((e) => overlaps(e, weekStart, weekEnd));
  const inMonth = monthEvents.filter((e) => overlaps(e, monthStart, monthEnd));
  const todayEvents = monthEvents
    .filter((e) => overlaps(e, todayStart, tomorrowStart))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start_at.localeCompare(b.start_at));

  return {
    today,
    todayEvents,
    upcoming: upRes.filter((e) => e.start_at >= tomorrowStart).slice(0, 50),
    overdue: overdueRes.results.map(toEvent),
    recentNotes: notesRes.results.map(toNote),
    todos: todosRes.results.map(toTodo),
    counts: {
      thisWeek: inWeek.length,
      thisMonth: inMonth.length,
      doneThisWeek: inWeek.filter((e) => e.done).length,
      notes: counts?.notes ?? 0,
      todosOpen: counts?.todosOpen ?? 0,
    },
  };
}

/* ----------------------------- To-dos ----------------------------- */

export async function listTodos(opts: { includeDone?: boolean; q?: string; limit?: number } = {}): Promise<Todo[]> {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (!opts.includeDone) where.push("done = 0");
  if (opts.q) {
    where.push(`(title LIKE ?${binds.length + 1} OR note LIKE ?${binds.length + 1})`);
    binds.push(`%${opts.q}%`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const sql = `SELECT * FROM todos ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY done ASC, important DESC, due_date IS NULL, due_date ASC, COALESCE(done_at, created_at) DESC LIMIT ${limit}`;
  const { results } = await db.prepare(sql).bind(...binds).all<TodoRow>();
  return results.map(toTodo);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first<TodoRow>();
  return row ? toTodo(row) : null;
}

export async function createTodo(input: TodoCreateInput): Promise<Todo> {
  const { db } = await ctx();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO todos (id, title, note, due_date, important, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(id, input.title.trim(), input.note?.trim() || null, input.due_date ?? null, input.important ? 1 : 0, now, now)
    .run();
  return (await getTodo(id))!;
}

export async function updateTodo(id: string, input: TodoUpdateInput): Promise<Todo | null> {
  const { db } = await ctx();
  const cur = await getTodo(id);
  if (!cur) return null;
  const done = input.done ?? cur.done;
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE todos SET title=?, note=?, due_date=?, important=?, done=?, done_at=?, updated_at=? WHERE id=?`,
    )
    .bind(
      input.title?.trim() ?? cur.title,
      input.note === undefined ? cur.note : input.note?.trim() || null,
      input.due_date === undefined ? cur.due_date : input.due_date,
      (input.important ?? cur.important) ? 1 : 0,
      done ? 1 : 0,
      done ? (cur.done ? cur.done_at : now) : null,
      now,
      id,
    )
    .run();
  return getTodo(id);
}

export async function deleteTodo(id: string): Promise<boolean> {
  const { db } = await ctx();
  const r = await db.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}
