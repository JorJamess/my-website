import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import type { Habit } from "@/lib/types";
import { habitPeriodStats, periodFor, rate } from "@/lib/analytics";
import { freshEnv } from "./helpers/env";

let env: CloudflareEnv;
beforeEach(() => {
  env = freshEnv();
});

type S = Pick<Habit, "schedule_type" | "weekdays" | "interval_days" | "start_date">;
const daily: S = { schedule_type: "daily", weekdays: null, interval_days: null, start_date: "2026-10-01" };
const mwf: S = { schedule_type: "weekdays", weekdays: [1, 3, 5], interval_days: null, start_date: "2026-10-01" };

describe("periodFor", () => {
  it("finds the Monday to Sunday week and the previous one", () => {
    const p = periodFor("week", 0, "2026-11-11"); // Wednesday
    expect([p.start, p.end]).toEqual(["2026-11-09", "2026-11-15"]);
    expect([p.prevStart, p.prevEnd]).toEqual(["2026-11-02", "2026-11-08"]);
    expect(p.days.length).toBe(7);
    expect(p.isCurrent).toBe(true);
  });
  it("moves back by whole weeks", () => {
    const p = periodFor("week", -2, "2026-11-11");
    expect(p.start).toBe("2026-10-26");
    expect(p.isCurrent).toBe(false);
  });
  it("finds the calendar month, including leap years and year boundaries", () => {
    const m = periodFor("month", 0, "2026-11-11");
    expect([m.start, m.end, m.days.length]).toEqual(["2026-11-01", "2026-11-30", 30]);
    expect([m.prevStart, m.prevEnd]).toEqual(["2026-10-01", "2026-10-31"]);
    const feb = periodFor("month", -9, "2026-11-11"); // Feb 2026
    expect(feb.end).toBe("2026-02-28");
    expect(periodFor("month", 0, "2028-03-10").prevEnd).toBe("2028-02-29");
    const jan = periodFor("month", 0, "2027-01-15");
    expect([jan.prevStart, jan.prevEnd]).toEqual(["2026-12-01", "2026-12-31"]);
    expect(periodFor("month", -1, "2027-01-15").start).toBe("2026-12-01");
  });
});

describe("habitPeriodStats", () => {
  const today = "2026-11-11";
  it("counts done over scheduled for closed days", () => {
    const done = new Set(["2026-11-09", "2026-11-10"]);
    expect(habitPeriodStats(daily, done, "2026-11-09", "2026-11-15", today)).toEqual({ done: 2, scheduled: 2 }); // today is open, future ignored
  });
  it("includes today once it is done", () => {
    expect(habitPeriodStats(daily, new Set(["2026-11-11"]), "2026-11-09", "2026-11-15", today)).toEqual({ done: 1, scheduled: 3 });
  });
  it("only counts scheduled days", () => {
    const done = new Set(["2026-11-09"]);
    expect(habitPeriodStats(mwf, done, "2026-11-02", "2026-11-08", today)).toEqual({ done: 0, scheduled: 3 });
    expect(habitPeriodStats(mwf, done, "2026-11-09", "2026-11-15", today)).toEqual({ done: 1, scheduled: 1 }); // Mon done, Wed is today (open)
  });
  it("ignores a period that has not started and one before the habit existed", () => {
    expect(habitPeriodStats(daily, new Set(), "2026-11-16", "2026-11-22", today)).toEqual({ done: 0, scheduled: 0 });
    expect(habitPeriodStats({ ...daily, start_date: "2026-11-10" }, new Set(), "2026-11-02", "2026-11-08", today)).toEqual({ done: 0, scheduled: 0 });
  });
  it("has a null rate with nothing scheduled", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});

describe("getAnalytics", () => {
  const today = "2026-11-11";
  const seedDone = (title: string, doneAtIso: string, extra: { due?: string; parent?: string } = {}) =>
    env.DB.prepare(
      `INSERT INTO todos (id, title, due_date, important, priority, status, done, done_at, parent_id, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 'done', 1, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), title, extra.due ?? null, doneAtIso, extra.parent ?? null, doneAtIso, doneAtIso)
      .run();

  it("counts completed tasks per local day and compares with the previous week", async () => {
    // done_at 23:30 UTC on Nov 9 is already Nov 10 in Thailand
    await seedDone("a", "2026-11-09T23:30:00.000Z");
    await seedDone("b", "2026-11-10T05:00:00.000Z");
    await seedDone("c", "2026-11-04T05:00:00.000Z"); // previous week
    await seedDone("old", "2026-10-01T05:00:00.000Z"); // outside both
    const a = await repo.getAnalytics({ range: "week", today });
    expect(a.tasks.completed).toBe(2);
    expect(a.tasks.prevCompleted).toBe(1);
    expect(a.days.find((d) => d.day === "2026-11-10")?.tasks).toBe(2);
    expect(a.days.find((d) => d.day === "2026-11-09")?.tasks).toBe(0);
    expect(a.days.length).toBe(7);
  });
  it("never counts subtasks as completed tasks", async () => {
    const parent = await repo.createTodo({ title: "p" });
    await seedDone("sub", "2026-11-10T05:00:00.000Z", { parent: parent.id });
    expect((await repo.getAnalytics({ range: "week", today })).tasks.completed).toBe(0);
  });
  it("reports tasks due in the period and the done share", async () => {
    await seedDone("d1", "2026-11-09T05:00:00.000Z", { due: "2026-11-10" });
    await repo.createTodo({ title: "d2", due_date: "2026-11-12" });
    await repo.createTodo({ title: "d3", due_date: "2026-11-30" });
    const a = await repo.getAnalytics({ range: "week", today });
    expect(a.tasks.due).toEqual({ total: 2, done: 1, rate: 0.5 });
    expect((await repo.getAnalytics({ range: "month", today })).tasks.due.total).toBe(3);
  });
  it("counts open and overdue tasks as of today", async () => {
    await repo.createTodo({ title: "late", due_date: "2026-11-01" });
    await repo.createTodo({ title: "fine", due_date: "2026-12-01" });
    const a = await repo.getAnalytics({ range: "week", today });
    expect(a.tasks.open).toBe(2);
    expect(a.tasks.overdue).toBe(1);
  });
  it("summarises each habit and the overall rate", async () => {
    const r = await repo.createHabit({ title: "Read", schedule_type: "daily", start_date: "2026-11-01" });
    for (const d of ["2026-11-09", "2026-11-10"]) await repo.setCheckin(r.id, { day: d });
    const a = await repo.getAnalytics({ range: "week", today });
    expect(a.habits.list[0]).toMatchObject({ title: "Read", done: 2, scheduled: 2, rate: 1 });
    expect(a.habits.checkins).toBe(2);
    expect(a.habits.rate).toBe(1);
    // previous week (Nov 2-8): no check-ins but scheduled all 7 days
    expect(a.habits.prevRate).toBe(0);
    expect(a.days.find((d) => d.day === "2026-11-10")?.habits).toBe(1);
  });
  it("counts goals and milestones", async () => {
    const g = await repo.createGoal({ title: "Goal", target_date: "2027-01-01" });
    const m = await repo.addMilestone(g.id, { title: "m" });
    await repo.updateMilestone(m.id, { done: true }); // done now (real clock), so use the real week
    const real = new Date().toISOString().slice(0, 10);
    const a = await repo.getAnalytics({ range: "month", today: real });
    expect(a.goals.active).toBe(1);
    expect(a.goals.milestonesDone).toBe(1);
    expect(a.goals.progress[0]).toMatchObject({ title: "Goal", percent: 1 });
  });
  it("clamps the offset and never looks into the future", async () => {
    const a = await repo.getAnalytics({ range: "week", offset: 5, today });
    expect(a.isCurrent).toBe(true);
    expect((await repo.getAnalytics({ range: "week", offset: -500, today })).isCurrent).toBe(false);
  });
});
