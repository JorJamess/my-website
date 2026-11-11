/** Time-slot maths for the calendar: which events collide, and where the free gaps are. All values are epoch milliseconds. */
export type Interval = { start: number; end: number };

/** A timed event with no end is treated as lasting an hour when checking for clashes. */
export const DEFAULT_EVENT_MINUTES = 60;

type EventTimes = { start_at: string; end_at: string | null; all_day: boolean };

/** The block of time an event occupies, or null for all-day events (they don't block a time of day). */
export function eventInterval(e: EventTimes): Interval | null {
  if (e.all_day) return null;
  const start = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : start + DEFAULT_EVENT_MINUTES * 60_000;
  return { start, end: Math.max(end, start + 1) };
}

/** Back-to-back is not a clash: 10:00–11:00 and 11:00–12:00 do not overlap. */
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** The gaps inside [windowStart, windowEnd) that are at least `minMinutes` long and not covered by `busy`. */
export function freeSlots(busy: Interval[], windowStart: number, windowEnd: number, minMinutes: number): Interval[] {
  const clipped = busy
    .map((b) => ({ start: Math.max(b.start, windowStart), end: Math.min(b.end, windowEnd) }))
    .filter((b) => b.end > b.start);
  const out: Interval[] = [];
  let cursor = windowStart;
  for (const b of mergeIntervals(clipped)) {
    if (b.start - cursor >= minMinutes * 60_000) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (windowEnd - cursor >= minMinutes * 60_000) out.push({ start: cursor, end: windowEnd });
  return out;
}
