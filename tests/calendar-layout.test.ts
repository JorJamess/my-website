import { describe, expect, it } from "vitest";
import { layoutDay, minutesLabel, segmentOnDay } from "@/lib/calendar-layout";
import { parseLocal } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

const ev = (id: string, start: string, end: string | null, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  description: null,
  location: null,
  start_at: parseLocal(start).toISOString(),
  end_at: end ? parseLocal(end).toISOString() : null,
  all_day: false,
  color: "blue",
  done: false,
  repeat_days: null,
  repeat_until: null,
  created_at: "",
  updated_at: "",
  ...extra,
});
const DAY = "2026-11-11";

describe("segmentOnDay", () => {
  it("gives minutes since midnight in Thailand time", () => {
    expect(segmentOnDay(ev("a", "2026-11-11 09:00", "2026-11-11 10:30"), DAY)).toEqual({ startMin: 540, endMin: 630 });
  });
  it("draws a short or open-ended event as at least 30 minutes", () => {
    expect(segmentOnDay(ev("a", "2026-11-11 09:00", null), DAY)).toEqual({ startMin: 540, endMin: 570 });
    expect(segmentOnDay(ev("a", "2026-11-11 09:00", "2026-11-11 09:10"), DAY)).toEqual({ startMin: 540, endMin: 570 });
  });
  it("clips an event that crosses midnight to each day", () => {
    const e = ev("night", "2026-11-11 22:00", "2026-11-12 02:00");
    expect(segmentOnDay(e, "2026-11-11")).toEqual({ startMin: 1320, endMin: 1440 });
    expect(segmentOnDay(e, "2026-11-12")).toEqual({ startMin: 0, endMin: 120 });
    expect(segmentOnDay(e, "2026-11-13")).toBeNull();
    expect(segmentOnDay(e, "2026-11-10")).toBeNull();
  });
  it("does not draw anything on the day after an event that ends at midnight", () => {
    const e = ev("late", "2026-11-11 22:00", "2026-11-12 00:00");
    expect(segmentOnDay(e, "2026-11-12")).toBeNull();
    expect(segmentOnDay(e, "2026-11-11")).toEqual({ startMin: 1320, endMin: 1440 });
  });
  it("ignores all-day events", () => {
    expect(segmentOnDay(ev("x", "2026-11-11 00:00", null, { all_day: true }), DAY)).toBeNull();
  });
});

describe("layoutDay", () => {
  it("gives a lone event the full width", () => {
    const [p] = layoutDay([ev("a", "2026-11-11 09:00", "2026-11-11 10:00")], DAY);
    expect([p.col, p.cols]).toEqual([0, 1]);
  });
  it("puts back-to-back events in the same column", () => {
    const out = layoutDay([ev("a", "2026-11-11 09:00", "2026-11-11 10:00"), ev("b", "2026-11-11 10:00", "2026-11-11 11:00")], DAY);
    expect(out.map((p) => [p.col, p.cols])).toEqual([[0, 1], [0, 1]]);
  });
  it("splits overlapping events side by side", () => {
    const out = layoutDay([ev("a", "2026-11-11 09:00", "2026-11-11 11:00"), ev("b", "2026-11-11 10:00", "2026-11-11 12:00")], DAY);
    expect(out.map((p) => [p.event.id, p.col, p.cols])).toEqual([["a", 0, 2], ["b", 1, 2]]);
  });
  it("reuses a freed column and sizes the group by its busiest moment", () => {
    const out = layoutDay(
      [
        ev("long", "2026-11-11 09:00", "2026-11-11 13:00"),
        ev("s1", "2026-11-11 09:30", "2026-11-11 10:30"),
        ev("s2", "2026-11-11 10:30", "2026-11-11 11:30"),
      ],
      DAY,
    );
    const by = Object.fromEntries(out.map((p) => [p.event.id, [p.col, p.cols]]));
    expect(by).toEqual({ long: [0, 2], s1: [1, 2], s2: [1, 2] });
  });
  it("lays out separate groups independently", () => {
    const out = layoutDay(
      [
        ev("a", "2026-11-11 09:00", "2026-11-11 10:00"),
        ev("b", "2026-11-11 09:30", "2026-11-11 10:30"),
        ev("c", "2026-11-11 14:00", "2026-11-11 15:00"),
      ],
      DAY,
    );
    expect(out.find((p) => p.event.id === "c")).toMatchObject({ col: 0, cols: 1 });
    expect(out.find((p) => p.event.id === "a")).toMatchObject({ cols: 2 });
  });
  it("handles three events that all overlap", () => {
    const out = layoutDay([ev("a", "2026-11-11 09:00", "2026-11-11 12:00"), ev("b", "2026-11-11 09:00", "2026-11-11 12:00"), ev("c", "2026-11-11 09:00", "2026-11-11 12:00")], DAY);
    expect(out.every((p) => p.cols === 3)).toBe(true);
    expect(out.map((p) => p.col).sort()).toEqual([0, 1, 2]);
  });
  it("returns nothing for a day with no timed events", () => {
    expect(layoutDay([ev("x", "2026-11-11 00:00", null, { all_day: true })], DAY)).toEqual([]);
  });
  it("formats minutes", () => {
    expect(minutesLabel(540)).toBe("09:00");
    expect(minutesLabel(1440)).toBe("00:00");
    expect(minutesLabel(615)).toBe("10:15");
  });
});
