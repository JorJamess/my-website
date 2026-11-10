import { describe, expect, it } from "vitest";
import { expandSeries, parseRepeatDays, repeatLabel, serializeRepeatDays } from "@/lib/recurrence";
import { localDateKey, parseLocal } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

const base: CalendarEvent = {
  id: "e1",
  title: "Gym",
  description: null,
  location: null,
  start_at: parseLocal("2026-11-09 18:00").toISOString(), // Monday
  end_at: parseLocal("2026-11-09 19:30").toISOString(),
  all_day: false,
  color: "green",
  done: false,
  repeat_days: [1, 3, 5],
  repeat_until: null,
  created_at: "",
  updated_at: "",
};
const range = (from: string, to: string) => [parseLocal(from).getTime(), parseLocal(to).getTime()] as const;
const days = (list: CalendarEvent[]) => list.map((e) => localDateKey(new Date(e.start_at)));

describe("repeat day helpers", () => {
  it("parses, dedupes and sorts", () => {
    expect(parseRepeatDays("5,1,3,3")).toEqual([1, 3, 5]);
    expect(parseRepeatDays("")).toBeNull();
    expect(parseRepeatDays(null)).toBeNull();
    expect(parseRepeatDays("9,x")).toBeNull();
  });
  it("serialises", () => {
    expect(serializeRepeatDays([5, 1])).toBe("1,5");
    expect(serializeRepeatDays([])).toBeNull();
  });
  it("labels", () => {
    expect(repeatLabel([1, 3, 5])).toBe("Every Mon, Wed, Fri");
    expect(repeatLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(repeatLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(repeatLabel([1], "2026-12-01")).toBe("Every Mon until 2026-12-01");
  });
});

describe("expandSeries skip list", () => {
  it("leaves out the skipped days only", () => {
    const out = expandSeries(base, ...range("2026-11-09", "2026-11-16"), new Set(["2026-11-11"]));
    expect(days(out)).toEqual(["2026-11-09", "2026-11-13"]);
  });
  it("ignores skip days that aren't occurrences", () => {
    expect(days(expandSeries(base, ...range("2026-11-09", "2026-11-16"), new Set(["2026-11-10"])))).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
  });
});

describe("expandSeries", () => {
  it("returns a non-repeating event unchanged", () => {
    const e = { ...base, repeat_days: null };
    expect(expandSeries(e, ...range("2026-11-01", "2026-12-01"))).toEqual([e]);
  });
  it("generates Mon/Wed/Fri occurrences inside the window", () => {
    const out = expandSeries(base, ...range("2026-11-09", "2026-11-16"));
    expect(days(out)).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
  });
  it("keeps the time of day and duration", () => {
    const [, second] = expandSeries(base, ...range("2026-11-09", "2026-11-16"));
    expect(second.start_at).toBe(parseLocal("2026-11-11 18:00").toISOString());
    expect(second.end_at).toBe(parseLocal("2026-11-11 19:30").toISOString());
  });
  it("never starts before the first occurrence", () => {
    const out = expandSeries(base, ...range("2026-10-01", "2026-11-09"));
    expect(out).toEqual([]);
  });
  it("stops after repeat_until (inclusive)", () => {
    const out = expandSeries({ ...base, repeat_until: "2026-11-13" }, ...range("2026-11-09", "2026-12-31"));
    expect(days(out)).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
  });
  it("marks occurrences as not done and records the series start", () => {
    const [first] = expandSeries({ ...base, done: true }, ...range("2026-11-09", "2026-11-10"));
    expect(first.done).toBe(false);
    expect(first.series_start_at).toBe(base.start_at);
  });
  it("includes a multi-day occurrence that began before the window", () => {
    const longEvent: CalendarEvent = {
      ...base,
      all_day: true,
      start_at: parseLocal("2026-11-09").toISOString(),
      end_at: parseLocal("2026-11-12").toISOString(), // Mon..Wed (exclusive end)
      repeat_days: [1],
    };
    const out = expandSeries(longEvent, ...range("2026-11-10", "2026-11-11"));
    expect(days(out)).toEqual(["2026-11-09"]);
  });
  it("handles a window that crosses a year end", () => {
    const e = { ...base, start_at: parseLocal("2026-12-28 09:00").toISOString(), end_at: null, repeat_days: [1] };
    expect(days(expandSeries(e, ...range("2026-12-28", "2027-01-12")))).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });
});
