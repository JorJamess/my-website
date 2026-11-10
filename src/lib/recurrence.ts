import { addDaysKey, localDateKey, weekdayIndex } from "./time";
import type { CalendarEvent } from "./types";

const DAY_MS = 86_400_000;

/** "1,3,5" -> [1,3,5] (sorted, unique, 0 = Sunday) */
export function parseRepeatDays(s: string | null | undefined): number[] | null {
  if (!s) return null;
  const days = [...new Set(s.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return days.length ? days : null;
}

export const serializeRepeatDays = (d: number[] | null | undefined) =>
  d && d.length ? [...new Set(d)].sort().join(",") : null;

/**
 * Turn one recurring series into its occurrences that overlap [fromMs, toMs).
 * Every occurrence keeps the series id. Days in `skip` (local YYYY-MM-DD of an occurrence's start) are left out.
 */
export function expandSeries(e: CalendarEvent, fromMs: number, toMs: number, skip?: ReadonlySet<string>): CalendarEvent[] {
  if (!e.repeat_days) return [e];
  const startMs = new Date(e.start_at).getTime();
  const duration = e.end_at ? new Date(e.end_at).getTime() - startMs : 0;
  const spanDays = Math.ceil(duration / DAY_MS);
  const seriesDay = localDateKey(new Date(startMs));
  const fromDay = localDateKey(new Date(fromMs));
  const lastDay = localDateKey(new Date(toMs - 1));

  let day = addDaysKey(fromDay, -spanDays);
  if (day < seriesDay) day = seriesDay;
  const out: CalendarEvent[] = [];
  for (let guard = 0; day <= lastDay && guard < 800; guard++, day = addDaysKey(day, 1)) {
    if (e.repeat_until && day > e.repeat_until) break;
    if (!e.repeat_days.includes(weekdayIndex(day))) continue;
    if (skip?.has(day)) continue; // this occurrence was removed from the series
    const shiftDays = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${seriesDay}T00:00:00Z`)) / DAY_MS);
    const s = startMs + shiftDays * DAY_MS;
    const en = e.end_at ? s + duration : null;
    if (s >= toMs || (en ?? s) < fromMs) continue;
    out.push({
      ...e,
      start_at: new Date(s).toISOString(),
      end_at: en === null ? null : new Date(en).toISOString(),
      done: false,
      series_start_at: e.start_at,
    });
  }
  return out;
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Every Mon, Wed, Fri" / "Every day" / "Weekdays" */
export function repeatLabel(days: number[] | null, until?: string | null) {
  if (!days) return "";
  const key = days.join(",");
  const base =
    key === "0,1,2,3,4,5,6" ? "Every day" : key === "1,2,3,4,5" ? "Weekdays" : `Every ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}`;
  return until ? `${base} until ${until}` : base;
}
