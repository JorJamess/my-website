import { addDaysKey, weekdayIndex } from "./time";
import type { Habit, HabitDayState, HabitStats } from "./types";

type Schedule = Pick<Habit, "schedule_type" | "weekdays" | "interval_days" | "start_date">;

const DAY_MS = 86_400_000;
/** Never look back further than this when computing streaks (keeps the loop bounded). */
const MAX_LOOKBACK_DAYS = 1100;

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Is the habit expected on this day? */
export function isScheduled(h: Schedule, day: string): boolean {
  if (day < h.start_date) return false;
  switch (h.schedule_type) {
    case "daily":
      return true;
    case "weekdays":
      return !!h.weekdays?.includes(weekdayIndex(day));
    case "interval": {
      const n = h.interval_days && h.interval_days > 0 ? h.interval_days : 1;
      return daysBetween(h.start_date, day) % n === 0;
    }
  }
}

/** Scheduled days in [from, to], oldest first. */
export function scheduledDays(h: Schedule, from: string, to: string): string[] {
  const out: string[] = [];
  let d = from < h.start_date ? h.start_date : from;
  for (let guard = 0; d <= to && guard < MAX_LOOKBACK_DAYS + 5; guard++, d = addDaysKey(d, 1)) {
    if (isScheduled(h, d)) out.push(d);
  }
  return out;
}

export function dayState(h: Schedule, done: Set<string>, today: string, day: string): HabitDayState {
  if (done.has(day)) return "done";
  if (!isScheduled(h, day)) return "off";
  if (day < today) return "missed";
  if (day === today) return "due";
  return "upcoming";
}

/**
 * Streaks and rates from a set of check-in days.
 * - Only scheduled days count; days off never break a streak.
 * - Today is "open": if it is scheduled and not done yet it neither counts for nor against you.
 * - Rate = done / scheduled over the last 30 days (closed days only), or null when nothing was scheduled.
 */
export function computeStats(h: Schedule, done: Set<string>, today: string): HabitStats {
  const lookbackStart = addDaysKey(today, -MAX_LOOKBACK_DAYS);
  const all = scheduledDays(h, lookbackStart, today);
  const scheduledToday = all.length > 0 && all[all.length - 1] === today;
  const closed = scheduledToday && !done.has(today) ? all.slice(0, -1) : all;

  let run = 0;
  let longest = 0;
  for (const d of closed) {
    if (done.has(d)) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  let current = 0;
  for (let i = closed.length - 1; i >= 0 && done.has(closed[i]); i--) current++;

  const windowStart = addDaysKey(today, -29);
  const inWindow = closed.filter((d) => d >= windowStart);
  const doneInWindow = inWindow.filter((d) => done.has(d)).length;

  return {
    current_streak: current,
    longest_streak: longest,
    last30: { done: doneInWindow, scheduled: inWindow.length, rate: inWindow.length ? doneInWindow / inWindow.length : null },
    done_today: done.has(today),
    scheduled_today: scheduledToday,
    total_checkins: done.size,
  };
}

/** Monday on or before `day`. */
export function weekStart(day: string) {
  return addDaysKey(day, -((weekdayIndex(day) + 6) % 7));
}

/** 12 weeks of day states, from the Monday 11 weeks ago to this week's Sunday. */
export function buildHistory(h: Schedule, done: Set<string>, today: string, weeks = 12) {
  const start = addDaysKey(weekStart(today), -7 * (weeks - 1));
  const out: { day: string; state: HabitDayState }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDaysKey(start, i);
    out.push({ day, state: dayState(h, done, today, day) });
  }
  return out;
}

export const SCHEDULE_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function scheduleLabel(h: Pick<Habit, "schedule_type" | "weekdays" | "interval_days">) {
  if (h.schedule_type === "daily") return "Every day";
  if (h.schedule_type === "interval") return `Every ${h.interval_days ?? 1} days`;
  const days = [...(h.weekdays ?? [])].sort();
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (days.length === 7) return "Every day";
  return days.map((d) => SCHEDULE_WEEKDAY_NAMES[d]).join(", ");
}
