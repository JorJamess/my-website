import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { addDaysKey, localDateKey } from "@/lib/time";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

describe("events", () => {
  it("creates, reads, updates and deletes", async () => {
    const e = await repo.createEvent({ title: " Exam ", start: "2026-11-12 09:00", end: "2026-11-12 12:00" });
    expect(e.title).toBe("Exam");
    expect(e.start_at).toBe("2026-11-12T02:00:00.000Z");
    expect(e.repeat_days).toBeNull();

    const u = await repo.updateEvent(e.id, { title: "Midterm", done: true });
    expect(u?.title).toBe("Midterm");
    expect(u?.done).toBe(true);

    expect(await repo.deleteEvent(e.id)).toBe(true);
    expect(await repo.getEvent(e.id)).toBeNull();
    expect(await repo.deleteEvent(e.id)).toBe(false);
  });

  it("rejects an end before the start and invalid dates", async () => {
    await expect(repo.createEvent({ title: "x", start: "2026-11-12 09:00", end: "2026-11-12 08:00" })).rejects.toThrow(repo.InputError);
    await expect(repo.createEvent({ title: "x", start: "not a date" })).rejects.toThrow(repo.InputError);
  });

  it("stores all-day events with an exclusive end", async () => {
    const e = await repo.createEvent({ title: "Trip", start: "2026-11-10", end: "2026-11-12", all_day: true });
    expect(e.start_at).toBe("2026-11-09T17:00:00.000Z");
    expect(e.end_at).toBe("2026-11-12T17:00:00.000Z"); // start of Nov 13 local
  });

  it("keeps the duration when only the start changes", async () => {
    const e = await repo.createEvent({ title: "Lab", start: "2026-11-12 13:00", end: "2026-11-12 16:00" });
    const u = await repo.updateEvent(e.id, { start: "2026-11-13 10:00" });
    expect(u?.start_at).toBe("2026-11-13T03:00:00.000Z");
    expect(u?.end_at).toBe("2026-11-13T06:00:00.000Z");
  });

  it("lists events overlapping a window and filters by query", async () => {
    await repo.createEvent({ title: "Inside", start: "2026-11-12 09:00" });
    await repo.createEvent({ title: "Outside", start: "2026-12-20 09:00" });
    await repo.createEvent({ title: "Lab report", start: "2026-11-13 09:00", location: "Building 4" });
    const all = await repo.listEvents({ from: "2026-11-01", to: "2026-12-01" });
    expect(all.map((e) => e.title)).toEqual(["Inside", "Lab report"]);
    const q = await repo.listEvents({ from: "2026-11-01", to: "2026-12-01", q: "building" });
    expect(q.map((e) => e.title)).toEqual(["Lab report"]);
  });

  it("unlinks notes when an event is deleted", async () => {
    const e = await repo.createEvent({ title: "Meeting", start: "2026-11-12 09:00" });
    const n = await repo.createNote({ title: "Minutes", event_id: e.id });
    await repo.deleteEvent(e.id);
    expect((await repo.getNote(n.id))?.event_id).toBeNull();
  });
});

describe("recurring events", () => {
  it("expands a weekly series when listing", async () => {
    await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", end: "2026-11-09 19:00", repeat_days: [1, 3, 5] });
    const list = await repo.listEvents({ from: "2026-11-09", to: "2026-11-16" });
    expect(list.map((e) => e.start_at.slice(0, 10))).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
  });
  it("respects repeat_until and excludes finished series from later windows", async () => {
    await repo.createEvent({ title: "Lab", start: "2026-11-11 13:00", repeat_days: [3], repeat_until: "2026-11-25" });
    expect((await repo.listEvents({ from: "2026-11-01", to: "2026-12-31" })).length).toBe(3);
    expect((await repo.listEvents({ from: "2026-12-01", to: "2026-12-31" })).length).toBe(0);
  });
  it("clears the rule with null and ignores done on series", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1] });
    const done = await repo.updateEvent(e.id, { done: true });
    expect(done?.done).toBe(false);
    const cleared = await repo.updateEvent(e.id, { repeat_days: null });
    expect(cleared?.repeat_days).toBeNull();
    expect(cleared?.repeat_until).toBeNull();
  });
  it("does not store repeat_until without repeat_days", async () => {
    const e = await repo.createEvent({ title: "x", start: "2026-11-09 18:00", repeat_until: "2026-12-01" });
    expect(e.repeat_until).toBeNull();
  });
});

describe("notes", () => {
  it("creates, searches, pins and deletes", async () => {
    const a = await repo.createNote({ title: "Graph theory", content: "BFS and DFS" });
    await repo.createNote({ title: "Shopping", content: "milk" });
    expect((await repo.listNotes({ q: "bfs" })).map((n) => n.id)).toEqual([a.id]);
    const p = await repo.updateNote(a.id, { pinned: true });
    expect(p?.pinned).toBe(true);
    expect((await repo.listNotes())[0].id).toBe(a.id);
    expect(await repo.deleteNote(a.id)).toBe(true);
  });
  it("rejects a link to a missing event", async () => {
    await expect(repo.createNote({ title: "x", event_id: "nope" })).rejects.toThrow(repo.InputError);
  });
});

describe("to-dos", () => {
  it("orders open tasks by star, then due date", async () => {
    await repo.createTodo({ title: "no date" });
    await repo.createTodo({ title: "later", due_date: "2026-12-01" });
    await repo.createTodo({ title: "soon", due_date: "2026-11-10" });
    await repo.createTodo({ title: "starred", important: true });
    const list = await repo.listTodos();
    expect(list.map((t) => t.title)).toEqual(["starred", "soon", "later", "no date"]);
  });
  it("tracks done_at and hides completed by default", async () => {
    const t = await repo.createTodo({ title: "Homework" });
    const d = await repo.updateTodo(t.id, { done: true });
    expect(d?.done).toBe(true);
    expect(d?.done_at).toBeTruthy();
    expect(await repo.listTodos()).toEqual([]);
    expect((await repo.listTodos({ includeDone: true })).length).toBe(1);
    const back = await repo.updateTodo(t.id, { done: false });
    expect(back?.done_at).toBeNull();
  });
  it("clears a due date with null and deletes", async () => {
    const t = await repo.createTodo({ title: "x", due_date: "2026-11-10" });
    expect((await repo.updateTodo(t.id, { due_date: null }))?.due_date).toBeNull();
    expect(await repo.deleteTodo(t.id)).toBe(true);
    expect(await repo.updateTodo(t.id, { done: true })).toBeNull();
  });
});

describe("summary", () => {
  it("counts open to-dos and notes and lists today's events", async () => {
    const today = localDateKey();
    await repo.createEvent({ title: "Today thing", start: `${today} 12:00` });
    await repo.createTodo({ title: "a" });
    const done = await repo.createTodo({ title: "b" });
    await repo.updateTodo(done.id, { done: true });
    await repo.createNote({ title: "n" });
    const s = await repo.getSummary(7);
    expect(s.todos.map((t) => t.title)).toEqual(["a"]);
    expect(s.counts.todosOpen).toBe(1);
    expect(s.counts.notes).toBe(1);
    expect(s.todayEvents.some((e) => e.title === "Today thing")).toBe(true);
  });
  it("does not list recurring series as overdue", async () => {
    await repo.createEvent({ title: "Gym", start: "2026-01-05 18:00", repeat_days: [1] });
    const s = await repo.getSummary(7);
    expect(s.overdue).toEqual([]);
  });
});

describe("habits", () => {
  it("creates, updates and deletes a habit with its history", async () => {
    const h = await repo.createHabit({ title: " Read ", schedule_type: "daily" });
    expect(h.title).toBe("Read");
    expect(h.start_date).toBe(localDateKey());
    await repo.setCheckin(h.id);
    const u = await repo.updateHabit(h.id, { title: "Read 20 min", schedule_type: "weekdays", weekdays: [1, 3] });
    expect(u?.weekdays).toEqual([1, 3]);
    expect(await repo.deleteHabit(h.id)).toBe(true);
    expect(await repo.getHabit(h.id)).toBeNull();
    const { db } = { db: (globalThis as unknown as { __testEnv: { DB: D1Database } }).__testEnv.DB };
    const left = await db.prepare("SELECT COUNT(*) AS n FROM habit_checkins").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("validates the schedule on create and on update", async () => {
    await expect(repo.createHabit({ title: "x", schedule_type: "interval" } as never)).rejects.toThrow();
    const h = await repo.createHabit({ title: "x", schedule_type: "interval", interval_days: 3 });
    await expect(repo.updateHabit(h.id, { schedule_type: "weekdays" })).rejects.toThrow(repo.InputError);
    expect((await repo.updateHabit(h.id, { schedule_type: "daily" }))?.interval_days).toBeNull();
  });

  it("checks in and out, idempotently, and refuses the future", async () => {
    const h = await repo.createHabit({ title: "Gym", schedule_type: "daily" });
    const today = localDateKey();
    await repo.setCheckin(h.id);
    await repo.setCheckin(h.id, { done: true }); // again: still one row
    let o = (await repo.getHabitsOverview())[0];
    expect(o.stats.done_today).toBe(true);
    expect(o.stats.total_checkins).toBe(1);
    await repo.setCheckin(h.id, { done: false });
    o = (await repo.getHabitsOverview())[0];
    expect(o.stats.done_today).toBe(false);
    await expect(repo.setCheckin(h.id, { day: "2999-01-01" })).rejects.toThrow(repo.InputError);
    await expect(repo.setCheckin("nope")).rejects.toThrow(repo.InputError);
    await expect(repo.setCheckin(h.id, { day: "2026-13-45" })).rejects.toThrow(repo.InputError);
    expect(today).toBeTruthy();
  });

  it("backfills a past day and reports streaks in the overview", async () => {
    const today = localDateKey();
    const h = await repo.createHabit({ title: "Read", schedule_type: "daily", start_date: addDaysKey(today, -5) });
    await repo.setCheckin(h.id, { day: addDaysKey(today, -2) });
    await repo.setCheckin(h.id, { day: addDaysKey(today, -1) });
    const [o] = await repo.getHabitsOverview();
    expect(o.stats.current_streak).toBe(2);
    expect(o.history.length).toBe(84);
    expect(o.history.find((d) => d.day === addDaysKey(today, -2))?.state).toBe("done");
  });

  it("hides archived habits unless asked, and lists today's scheduled ones", async () => {
    const a = await repo.createHabit({ title: "A", schedule_type: "daily" });
    await repo.createHabit({ title: "B", schedule_type: "daily" });
    await repo.updateHabit(a.id, { archived: true });
    expect((await repo.getHabitsOverview()).map((h) => h.title)).toEqual(["B"]);
    expect((await repo.getHabitsOverview({ includeArchived: true })).length).toBe(2);
    expect((await repo.getHabitsToday()).map((h) => h.title)).toEqual(["B"]);
    await repo.updateHabit(a.id, { archived: false });
    expect((await repo.getHabitsToday()).length).toBe(2);
  });

  it("puts today's habits in the summary", async () => {
    await repo.createHabit({ title: "Read", schedule_type: "daily" });
    const s = await repo.getSummary(7);
    expect(s.habitsToday.map((h) => h.title)).toEqual(["Read"]);
  });
});
