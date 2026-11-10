import "server-only";
import type { EventColor, Habit, HabitOverview, HabitToday } from "@/lib/types";
import { checkHabitSchedule, type CheckinInput, type HabitCreateInput, type HabitUpdateInput } from "@/lib/schemas";
import { buildHistory, computeStats } from "@/lib/habits";
import { parseRepeatDays, serializeRepeatDays } from "@/lib/recurrence";
import { isValidDate, localDateKey, parseLocal } from "@/lib/time";
import { ctx, InputError } from "../core";

type HabitRow = Omit<Habit, "weekdays" | "color"> & { weekdays: string | null; color: string };

const toHabit = (r: HabitRow): Habit => ({
  ...r,
  weekdays: parseRepeatDays(r.weekdays),
  color: r.color as EventColor,
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function assertDay(day: string, what: string) {
  if (!DAY.test(day) || !isValidDate(parseLocal(day))) throw new InputError(`Invalid ${what}: "${day}"`);
}

export async function listHabits(opts: { includeArchived?: boolean } = {}): Promise<Habit[]> {
  const { db } = await ctx();
  const { results } = await db
    .prepare(`SELECT * FROM habits ${opts.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY created_at ASC`)
    .all<HabitRow>();
  return results.map(toHabit);
}

export async function getHabit(id: string): Promise<Habit | null> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM habits WHERE id = ?").bind(id).first<HabitRow>();
  return row ? toHabit(row) : null;
}

export async function createHabit(input: HabitCreateInput): Promise<Habit> {
  const { db, tz } = await ctx();
  const scheduleError = checkHabitSchedule(input);
  if (scheduleError) throw new InputError(scheduleError);
  const start = input.start_date ?? localDateKey(new Date(), tz);
  assertDay(start, "start date");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO habits (id, title, description, color, schedule_type, weekdays, interval_days, start_date, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.title.trim(),
      input.description?.trim() || null,
      input.color ?? "blue",
      input.schedule_type,
      input.schedule_type === "weekdays" ? serializeRepeatDays(input.weekdays) : null,
      input.schedule_type === "interval" ? (input.interval_days ?? null) : null,
      start,
      now,
      now,
    )
    .run();
  return (await getHabit(id))!;
}

export async function updateHabit(id: string, input: HabitUpdateInput): Promise<Habit | null> {
  const { db } = await ctx();
  const cur = await getHabit(id);
  if (!cur) return null;
  const type = input.schedule_type ?? cur.schedule_type;
  const weekdays = input.weekdays === undefined ? cur.weekdays : input.weekdays;
  const interval = input.interval_days === undefined ? cur.interval_days : input.interval_days;
  const err = checkHabitSchedule({ schedule_type: type, weekdays, interval_days: interval });
  if (err) throw new InputError(err);
  const start = input.start_date ?? cur.start_date;
  assertDay(start, "start date");
  const now = new Date().toISOString();
  const archived = input.archived === undefined ? cur.archived_at : input.archived ? (cur.archived_at ?? now) : null;
  await db
    .prepare(
      `UPDATE habits SET title=?, description=?, color=?, schedule_type=?, weekdays=?, interval_days=?, start_date=?, archived_at=?, updated_at=? WHERE id=?`,
    )
    .bind(
      input.title?.trim() ?? cur.title,
      input.description === undefined ? cur.description : input.description?.trim() || null,
      input.color ?? cur.color,
      type,
      type === "weekdays" ? serializeRepeatDays(weekdays) : null,
      type === "interval" ? interval : null,
      start,
      archived,
      now,
      id,
    )
    .run();
  return getHabit(id);
}

/** Deletes the habit and its whole history. */
export async function deleteHabit(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("DELETE FROM habit_checkins WHERE habit_id = ?").bind(id).run();
  await db.prepare("DELETE FROM goal_links WHERE entity_type = 'habit' AND entity_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM habits WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Tick (or untick) a habit for one day. Past days are allowed, future days are not. */
export async function setCheckin(id: string, input: CheckinInput = {}): Promise<{ habit: Habit; day: string; done: boolean }> {
  const { db, tz } = await ctx();
  const habit = await getHabit(id);
  if (!habit) throw new InputError(`No habit with id ${id}`);
  const today = localDateKey(new Date(), tz);
  const day = input.day ?? today;
  assertDay(day, "day");
  if (day > today) throw new InputError("You can't check in for a day that hasn't happened yet");
  const done = input.done ?? true;
  if (done) {
    await db
      .prepare(
        `INSERT INTO habit_checkins (habit_id, day, note, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(habit_id, day) DO UPDATE SET note = COALESCE(?3, note)`,
      )
      .bind(id, day, input.note?.trim() || null, new Date().toISOString())
      .run();
  } else {
    await db.prepare("DELETE FROM habit_checkins WHERE habit_id = ? AND day = ?").bind(id, day).run();
  }
  return { habit, day, done };
}

async function checkinsByHabit(db: D1Database): Promise<Map<string, Set<string>>> {
  const { results } = await db.prepare("SELECT habit_id, day FROM habit_checkins").all<{ habit_id: string; day: string }>();
  const map = new Map<string, Set<string>>();
  for (const r of results) {
    if (!map.has(r.habit_id)) map.set(r.habit_id, new Set());
    map.get(r.habit_id)!.add(r.day);
  }
  return map;
}

/** Every active habit with its streaks, rate and 12 weeks of history. */
export async function getHabitsOverview(opts: { includeArchived?: boolean } = {}): Promise<HabitOverview[]> {
  const { db, tz } = await ctx();
  const today = localDateKey(new Date(), tz);
  const [habits, byHabit] = await Promise.all([listHabits(opts), checkinsByHabit(db)]);
  return habits.map((h) => {
    const done = byHabit.get(h.id) ?? new Set<string>();
    return { ...h, stats: computeStats(h, done, today), history: buildHistory(h, done, today) };
  });
}

/** Habits that are scheduled today, for the Today page and Claude's daily summary. */
export async function getHabitsToday(): Promise<HabitToday[]> {
  const overview = await getHabitsOverview();
  return overview
    .filter((h) => h.stats.scheduled_today)
    .map((h) => ({ id: h.id, title: h.title, color: h.color, done: h.stats.done_today, current_streak: h.stats.current_streak }));
}
