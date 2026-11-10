import { describe, expect, it } from "vitest";
import { addDaysKey, eventDayRange, formatLocal, localDateKey, parseLocal, splitLocal, weekdayIndex } from "@/lib/time";

describe("time helpers (fixed UTC+07:00)", () => {
  it("parses local date-times as Thailand time", () => {
    expect(parseLocal("2026-11-08 14:30").toISOString()).toBe("2026-11-08T07:30:00.000Z");
    expect(parseLocal("2026-11-08").toISOString()).toBe("2026-11-07T17:00:00.000Z");
  });
  it("respects an explicit offset or Z", () => {
    expect(parseLocal("2026-11-08T10:00:00Z").toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(parseLocal("2026-11-08T10:00:00+09:00").toISOString()).toBe("2026-11-08T01:00:00.000Z");
  });
  it("formats and splits in local time", () => {
    expect(formatLocal("2026-11-08T17:30:00.000Z")).toBe("2026-11-09T00:30+07:00");
    expect(splitLocal("2026-11-08T17:30:00.000Z")).toEqual({ date: "2026-11-09", time: "00:30" });
  });
  it("uses the local day, not the UTC day", () => {
    expect(localDateKey(new Date("2026-11-08T18:00:00Z"))).toBe("2026-11-09");
  });
  it("adds days across month and year ends", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("gives the weekday (0 = Sunday)", () => {
    expect(weekdayIndex("2026-11-09")).toBe(1); // Monday
    expect(weekdayIndex("2026-11-08")).toBe(0);
  });
  it("treats an all-day end as exclusive when computing the last day", () => {
    const e = { start_at: "2026-11-09T00:00:00+07:00", end_at: "2026-11-11T00:00:00+07:00", all_day: true };
    expect(eventDayRange({ ...e, start_at: new Date(e.start_at).toISOString(), end_at: new Date(e.end_at).toISOString() })).toEqual([
      "2026-11-09",
      "2026-11-10",
    ]);
  });
});
