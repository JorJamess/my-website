import "server-only";
import type { CalendarEvent, EventColor } from "@/lib/types";
import type { EventCreateInput, EventUpdateInput } from "@/lib/schemas";
import { localDateKey } from "@/lib/time";
import { expandSeries, parseRepeatDays, serializeRepeatDays } from "@/lib/recurrence";
import { ctx, parseOrThrow, resolveTimes } from "../core";

export type EventRow = Omit<CalendarEvent, "all_day" | "done" | "color" | "repeat_days"> & {
  all_day: number;
  done: number;
  color: string;
  repeat_days: string | null;
};

export const toEvent = (r: EventRow): CalendarEvent => ({
  ...r,
  all_day: !!r.all_day,
  done: !!r.done,
  color: r.color as EventColor,
  repeat_days: parseRepeatDays(r.repeat_days),
});

/* ----------------------------- Events ----------------------------- */

/** Events overlapping [fromISO, toISO), with recurring series expanded into occurrences. */
export async function fetchEvents(
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

