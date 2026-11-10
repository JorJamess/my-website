import { addDaysKey } from "./time";
import { scheduledDays, weekStart } from "./habits";
import type { Habit } from "./types";

export type AnalyticsRange = "week" | "month";

export type Period = {
  range: AnalyticsRange;
  start: string; // first day, YYYY-MM-DD
  end: string; // last day (inclusive)
  prevStart: string;
  prevEnd: string;
  days: string[];
  isCurrent: boolean;
};

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The week (Monday to Sunday) or calendar month `offset` periods away from the one containing `today`. */
export function periodFor(range: AnalyticsRange, offset: number, today: string): Period {
  let start: string;
  let end: string;
  let prevStart: string;
  let prevEnd: string;
  if (range === "week") {
    start = addDaysKey(weekStart(today), offset * 7);
    end = addDaysKey(start, 6);
    prevStart = addDaysKey(start, -7);
    prevEnd = addDaysKey(start, -1);
  } else {
    const [y, m] = today.split("-").map(Number);
    const idx = y * 12 + (m - 1) + offset;
    const ys = Math.floor(idx / 12);
    const ms = (idx % 12) + 1;
    start = `${ys}-${String(ms).padStart(2, "0")}-01`;
    end = `${ys}-${String(ms).padStart(2, "0")}-${String(daysInMonth(ys, ms)).padStart(2, "0")}`;
    const pidx = idx - 1;
    const py = Math.floor(pidx / 12);
    const pm = (pidx % 12) + 1;
    prevStart = `${py}-${String(pm).padStart(2, "0")}-01`;
    prevEnd = `${py}-${String(pm).padStart(2, "0")}-${String(daysInMonth(py, pm)).padStart(2, "0")}`;
  }
  const days: string[] = [];
  for (let d = start; d <= end; d = addDaysKey(d, 1)) days.push(d);
  return { range, start, end, prevStart, prevEnd, days, isCurrent: today >= start && today <= end };
}

/**
 * How a habit did over [from, to]: done / scheduled, counting only days that are over.
 * Days in the future are ignored, and today is ignored until it's ticked (it isn't "missed" yet).
 */
export function habitPeriodStats(
  h: Pick<Habit, "schedule_type" | "weekdays" | "interval_days" | "start_date">,
  done: Set<string>,
  from: string,
  to: string,
  today: string,
): { done: number; scheduled: number } {
  const last = to < today ? to : today;
  if (last < from) return { done: 0, scheduled: 0 };
  const days = scheduledDays(h, from, last).filter((d) => d < today || done.has(d));
  return { done: days.filter((d) => done.has(d)).length, scheduled: days.length };
}

export const rate = (done: number, total: number) => (total > 0 ? done / total : null);
