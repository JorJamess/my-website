import { describe, expect, it } from "vitest";
import type { Habit } from "@/lib/types";
import { buildHistory, computeStats, dayState, isScheduled, scheduleLabel, scheduledDays, weekStart } from "@/lib/habits";

type S = Pick<Habit, "schedule_type" | "weekdays" | "interval_days" | "start_date">;
const daily: S = { schedule_type: "daily", weekdays: null, interval_days: null, start_date: "2026-11-01" };
const mwf: S = { schedule_type: "weekdays", weekdays: [1, 3, 5], interval_days: null, start_date: "2026-11-01" };
const every3: S = { schedule_type: "interval", weekdays: null, interval_days: 3, start_date: "2026-11-01" };
const set = (...d: string[]) => new Set(d);

describe("isScheduled", () => {
  it("is false before the start date", () => {
    expect(isScheduled(daily, "2026-10-31")).toBe(false);
    expect(isScheduled(daily, "2026-11-01")).toBe(true);
  });
  it("follows chosen weekdays", () => {
    expect(isScheduled(mwf, "2026-11-09")).toBe(true); // Monday
    expect(isScheduled(mwf, "2026-11-10")).toBe(false); // Tuesday
    expect(isScheduled(mwf, "2026-11-13")).toBe(true); // Friday
  });
  it("counts every N days from the start date", () => {
    expect(scheduledDays(every3, "2026-11-01", "2026-11-12")).toEqual(["2026-11-01", "2026-11-04", "2026-11-07", "2026-11-10"]);
  });
});

describe("computeStats", () => {
  const today = "2026-11-10";
  it("counts a run ending today", () => {
    const s = computeStats(daily, set("2026-11-08", "2026-11-09", "2026-11-10"), today);
    expect(s.current_streak).toBe(3);
    expect(s.done_today).toBe(true);
  });
  it("does not break the streak when today is still open", () => {
    const s = computeStats(daily, set("2026-11-08", "2026-11-09"), today);
    expect(s.current_streak).toBe(2);
    expect(s.done_today).toBe(false);
    expect(s.scheduled_today).toBe(true);
  });
  it("breaks the streak on a missed closed day", () => {
    const s = computeStats(daily, set("2026-11-07", "2026-11-09", "2026-11-10"), today);
    expect(s.current_streak).toBe(2);
    expect(s.longest_streak).toBe(2);
  });
  it("tracks the longest streak separately from the current one", () => {
    const s = computeStats(daily, set("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09"), today);
    expect(s.longest_streak).toBe(4);
    expect(s.current_streak).toBe(1);
  });
  it("ignores days off for weekday schedules", () => {
    // Mon 2, Wed 4, Fri 6, Mon 9 all done; Tue/Thu/Sat/Sun off
    const s = computeStats(mwf, set("2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09"), "2026-11-10");
    expect(s.current_streak).toBe(4);
    expect(s.scheduled_today).toBe(false);
  });
  it("a missed scheduled weekday breaks it", () => {
    const s = computeStats(mwf, set("2026-11-02", "2026-11-06", "2026-11-09"), "2026-11-10");
    expect(s.current_streak).toBe(2); // Mon 9, Fri 6 done; Wed 4 missed
  });
  it("a check-in on a day off does not affect streaks but is counted in total", () => {
    const s = computeStats(mwf, set("2026-11-09", "2026-11-10"), "2026-11-10");
    expect(s.current_streak).toBe(1);
    expect(s.total_checkins).toBe(2);
  });
  it("computes the 30 day rate over closed days only", () => {
    // started Nov 1, today Nov 10 (open, not done) -> closed days Nov 1..9 = 9 days; done 3
    const s = computeStats(daily, set("2026-11-01", "2026-11-05", "2026-11-09"), "2026-11-10");
    expect(s.last30).toEqual({ done: 3, scheduled: 9, rate: 3 / 9 });
  });
  it("includes today in the rate once it is done", () => {
    const s = computeStats(daily, set("2026-11-10"), "2026-11-10");
    expect(s.last30.scheduled).toBe(10);
    expect(s.last30.done).toBe(1);
  });
  it("gives a null rate when nothing has been scheduled yet", () => {
    const s = computeStats({ ...daily, start_date: "2026-11-10" }, set(), "2026-11-10");
    expect(s.last30.rate).toBeNull();
    expect(s.current_streak).toBe(0);
  });
  it("only looks at the last 30 days for the rate", () => {
    const s = computeStats({ ...daily, start_date: "2026-01-01" }, set(), "2026-11-10");
    expect(s.last30.scheduled).toBe(29); // Oct 12..Nov 9
  });
  it("handles a habit that has not started", () => {
    const s = computeStats({ ...daily, start_date: "2026-12-01" }, set(), "2026-11-10");
    expect(s).toMatchObject({ current_streak: 0, longest_streak: 0, scheduled_today: false });
  });
  it("works across a month and year boundary", () => {
    const s = computeStats({ ...daily, start_date: "2026-12-01" }, set("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-01");
    expect(s.current_streak).toBe(3);
  });
});

describe("day states and history", () => {
  const today = "2026-11-10";
  it("labels each kind of day", () => {
    const done = set("2026-11-09");
    expect(dayState(mwf, done, today, "2026-11-09")).toBe("done");
    expect(dayState(mwf, done, today, "2026-11-06")).toBe("missed");
    expect(dayState(mwf, done, today, "2026-11-10")).toBe("off");
    expect(dayState(mwf, done, today, "2026-11-11")).toBe("upcoming");
    expect(dayState(daily, set(), today, today)).toBe("due");
  });
  it("builds 12 whole weeks, Monday to Sunday, ending this week", () => {
    const h = buildHistory(daily, set(), today);
    expect(h.length).toBe(84);
    expect(h[0].day).toBe(weekStart("2026-08-24")); // 11 weeks before Mon Nov 9
    expect(h[0].day).toBe("2026-08-24");
    expect(h[83].day).toBe("2026-11-15"); // Sunday of this week
  });
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday -> previous Monday
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });
});

describe("scheduleLabel", () => {
  it("describes schedules", () => {
    expect(scheduleLabel(daily)).toBe("Every day");
    expect(scheduleLabel(mwf)).toBe("Mon, Wed, Fri");
    expect(scheduleLabel({ schedule_type: "weekdays", weekdays: [1, 2, 3, 4, 5], interval_days: null })).toBe("Weekdays");
    expect(scheduleLabel({ schedule_type: "weekdays", weekdays: [6, 0], interval_days: null })).toBe("Weekends");
    expect(scheduleLabel(every3)).toBe("Every 3 days");
  });
});
