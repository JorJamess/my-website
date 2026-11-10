import { eventDayRange, splitLocal } from "./time";
import type { CalendarEvent } from "./types";

export const MIN_LENGTH = 30; // minutes: the shortest block we draw, so a point-in-time event is still clickable

export type Placed = { event: CalendarEvent; startMin: number; endMin: number; col: number; cols: number };

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The part of a timed event that falls on `day`, as minutes since midnight. null if it doesn't touch that day. */
export function segmentOnDay(e: CalendarEvent, day: string): { startMin: number; endMin: number } | null {
  if (e.all_day) return null;
  const [sDay, eDay] = eventDayRange(e);
  if (day < sDay || day > eDay) return null;
  const startMin = day === sDay ? toMin(splitLocal(e.start_at).time) : 0;
  let endMin: number;
  if (!e.end_at) endMin = startMin + MIN_LENGTH;
  else if (day === eDay) {
    endMin = toMin(splitLocal(e.end_at).time);
    if (endMin === 0 && day > sDay) return null; // ends exactly at midnight: nothing on the last day
  } else endMin = 1440;
  return { startMin, endMin: Math.min(1440, Math.max(endMin, startMin + MIN_LENGTH)) };
}

/**
 * Lay out one day's timed events. Events that overlap in time share the width side by side:
 * each group of overlapping events is split into as many columns as its busiest moment needs.
 */
export function layoutDay(events: CalendarEvent[], day: string): Placed[] {
  const segs = events
    .map((event) => ({ event, seg: segmentOnDay(event, day) }))
    .filter((x): x is { event: CalendarEvent; seg: { startMin: number; endMin: number } } => !!x.seg)
    .map(({ event, seg }) => ({ event, ...seg, col: 0, cols: 1 }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    for (const p of cluster) out.push({ ...p, cols });
    cluster = [];
    clusterEnd = -1;
  };
  for (const s of segs) {
    if (cluster.length && s.startMin >= clusterEnd) flush();
    // first column whose last event has already ended
    const lastEnds: number[] = [];
    for (const p of cluster) lastEnds[p.col] = Math.max(lastEnds[p.col] ?? 0, p.endMin);
    let col = 0;
    while (col < lastEnds.length && lastEnds[col] > s.startMin) col++;
    cluster.push({ ...s, col });
    clusterEnd = Math.max(clusterEnd, s.endMin);
  }
  if (cluster.length) flush();
  return out;
}

/** "14:00–15:30" for the block on this day */
export const minutesLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
