import "server-only";
import type { CalendarEvent, Summary } from "@/lib/types";
import { addDaysKey, localDateKey, parseLocal } from "@/lib/time";
import { ctx } from "../core";
import { fetchEvents, toEvent, type EventRow } from "../events/repo";
import { toNote, type NoteRow } from "../notes/repo";
import { toTodo, type TodoRow } from "../tasks/repo";
import { getHabitsToday } from "../habits/repo";

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

  const [monthEvents, upRes, overdueRes, notesRes, todosRes, counts, habitsToday] = await Promise.all([
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
    getHabitsToday(),
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
    habitsToday,
    counts: {
      thisWeek: inWeek.length,
      thisMonth: inMonth.length,
      doneThisWeek: inWeek.filter((e) => e.done).length,
      notes: counts?.notes ?? 0,
      todosOpen: counts?.todosOpen ?? 0,
    },
  };
}

