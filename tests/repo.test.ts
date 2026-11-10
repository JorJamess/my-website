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

describe("summary for the Today page", () => {
  it("separates overdue tasks from today's focus tasks", async () => {
    const today = localDateKey();
    await repo.createTodo({ title: "overdue", due_date: addDaysKey(today, -1) });
    await repo.createTodo({ title: "due today", due_date: today });
    const doneToday = await repo.createTodo({ title: "done today", due_date: today });
    await repo.updateTodo(doneToday.id, { done: true });
    await repo.createTodo({ title: "high no date", priority: "high" });
    await repo.createTodo({ title: "high overdue", priority: "high", due_date: addDaysKey(today, -2) });
    await repo.createTodo({ title: "low someday" });
    await repo.createTodo({ title: "later", due_date: addDaysKey(today, 5) });
    const sub = await repo.createTodo({ title: "parent" });
    await repo.createTodo({ title: "sub overdue", parent_id: sub.id, due_date: addDaysKey(today, -1) });

    const s = await repo.getSummary(7);
    expect(s.overdueTodos.map((t) => t.title).sort()).toEqual(["high overdue", "overdue"]);
    expect(s.todosFocus.map((t) => t.title)).toEqual(["high no date", "due today", "done today"]);
    // overdue tasks are not repeated in the focus list, and subtasks never appear
    expect(s.todosFocus.some((t) => t.title === "high overdue")).toBe(false);
    expect([...s.overdueTodos, ...s.todosFocus].some((t) => t.parent_id)).toBe(false);
  });
});

describe("calendar items and colour names", () => {
  it("lists tasks and milestones due in a range, and ignores subtasks and finished goals", async () => {
    const t = await repo.createTodo({ title: "Report", due_date: "2026-11-12" });
    await repo.createTodo({ title: "Sub", parent_id: t.id, due_date: "2026-11-12" });
    await repo.createTodo({ title: "Later", due_date: "2026-12-30" });
    const g = await repo.createGoal({ title: "Goal", color: "purple" });
    await repo.addMilestone(g.id, { title: "Grammar", due_date: "2026-11-13" });
    const done = await repo.createGoal({ title: "Done goal", status: "done" });
    await repo.addMilestone(done.id, { title: "Hidden", due_date: "2026-11-13" });

    const c = await repo.getCalendarItems("2026-11-09", "2026-11-15");
    expect(c.tasks.map((x) => x.title)).toEqual(["Report"]);
    expect(c.milestones.map((m) => [m.title, m.goal_title, m.color])).toEqual([["Grammar", "Goal", "purple"]]);
  });
  it("rejects bad ranges", async () => {
    await expect(repo.getCalendarItems("nope", "2026-11-15")).rejects.toThrow(repo.InputError);
    await expect(repo.getCalendarItems("2026-11-15", "2026-11-09")).rejects.toThrow(repo.InputError);
  });
  it("renames colours, falls back to defaults, and trims", async () => {
    expect((await repo.getColorNames()).blue).toBe("Blue");
    const n = await repo.setColorNames({ blue: "  Study  ", green: "Health" });
    expect(n.blue).toBe("Study");
    expect((await repo.getColorNames()).green).toBe("Health");
    expect((await repo.setColorNames({ blue: "   " })).blue).toBe("Blue");
    expect((await repo.getColorNames()).green).toBe("Health"); // untouched
  });
});

describe("one occurrence of a repeating event", () => {
  const week = ["2026-11-09", "2026-11-16"] as const;
  const titles = async () => (await repo.listEvents({ from: week[0], to: "2026-11-23" })).map((e) => `${e.title}@${e.start_at.slice(0, 10)}`);

  it("skips one occurrence and keeps the rest, and restoring brings it back", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1, 3] });
    await repo.skipOccurrence(e.id, "2026-11-11");
    expect(await titles()).not.toContain("Gym@2026-11-11");
    expect(await titles()).toEqual(expect.arrayContaining(["Gym@2026-11-09", "Gym@2026-11-16", "Gym@2026-11-18"]));
    await repo.skipOccurrence(e.id, "2026-11-11"); // twice is fine
    expect(await repo.restoreOccurrence(e.id, "2026-11-11")).toBe(true);
    expect(await repo.restoreOccurrence(e.id, "2026-11-11")).toBe(false);
    expect(await titles()).toContain("Gym@2026-11-11");
  });
  it("only skips real occurrences of a repeating event", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1], repeat_until: "2026-11-30" });
    const once = await repo.createEvent({ title: "Once", start: "2026-11-10 10:00" });
    await expect(repo.skipOccurrence(e.id, "2026-11-10")).rejects.toThrow(repo.InputError); // a Tuesday
    await expect(repo.skipOccurrence(e.id, "2026-11-02")).rejects.toThrow(repo.InputError); // before the start
    await expect(repo.skipOccurrence(e.id, "2026-12-07")).rejects.toThrow(repo.InputError); // after the end
    await expect(repo.skipOccurrence(once.id, "2026-11-10")).rejects.toThrow(repo.InputError); // doesn't repeat
    await expect(repo.skipOccurrence("nope", "2026-11-10")).rejects.toThrow(repo.InputError);
    await expect(repo.skipOccurrence(e.id, "not a day")).rejects.toThrow(repo.InputError);
  });
  it("edit-just-this-one moves the occurrence out into its own event", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", end: "2026-11-09 19:00", repeat_days: [1], color: "orange" });
    const one = await repo.detachOccurrence(e.id, "2026-11-16", { title: "Gym (late)", start: "2026-11-16 20:00", end: "2026-11-16 21:00", color: "orange" });
    expect(one.repeat_days).toBeNull();
    const list = await titles();
    expect(list).toContain("Gym (late)@2026-11-16");
    expect(list).not.toContain("Gym@2026-11-16");
    expect(list).toContain("Gym@2026-11-09");
  });
  it("a detached event that tries to repeat is stored as a one-off", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1] });
    const one = await repo.detachOccurrence(e.id, "2026-11-09", { title: "x", start: "2026-11-09 20:00", repeat_days: [1, 2] });
    expect(one.repeat_days).toBeNull();
  });
  it("deleting the series removes its skipped days", async () => {
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1] });
    await repo.skipOccurrence(e.id, "2026-11-16");
    await repo.deleteEvent(e.id);
    const left = await (globalThis as unknown as { __testEnv: { DB: D1Database } }).__testEnv.DB.prepare("SELECT COUNT(*) AS n FROM event_exceptions").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("notes: folders, tags and links", () => {
  it("files notes in folders and filters by folder and tag", async () => {
    const a = await repo.createNote({ title: "Kanji", folder: "Study", tags: ["#Japanese", "japanese", "Exam "] });
    await repo.createNote({ title: "Milk", tags: ["home"] });
    expect(a.folder?.name).toBe("Study");
    expect(a.tags).toEqual(["exam", "japanese"]);
    expect((await repo.listNotes({ folder: "study" })).map((n) => n.id)).toEqual([a.id]);
    expect((await repo.listNotes({ folder: "none" })).length).toBe(1);
    expect((await repo.listNotes({ tag: "#Exam" })).map((n) => n.id)).toEqual([a.id]);
    expect((await repo.listNotes({ q: "japan" })).map((n) => n.id)).toEqual([a.id]);
    expect((await repo.listFolders())[0]).toMatchObject({ name: "Study", count: 1 });
    expect((await repo.listTags()).map((t) => t.tag)).toEqual(["exam", "home", "japanese"]);
  });
  it("replaces tags, moves out of a folder, and keeps notes when a folder is deleted", async () => {
    const a = await repo.createNote({ title: "x", folder: "F", tags: ["a", "b"] });
    const u = await repo.updateNote(a.id, { tags: ["c"], folder: null });
    expect(u?.tags).toEqual(["c"]);
    expect(u?.folder).toBeNull();
    const b = await repo.createNote({ title: "y", folder: "G" });
    expect(await repo.deleteFolder(b.folder!.id)).toBe(true);
    expect((await repo.getNote(b.id))?.folder).toBeNull();
  });
  it("renames a folder and refuses a duplicate name", async () => {
    const f1 = await repo.createFolder("One");
    await repo.createFolder("Two");
    expect((await repo.renameFolder(f1.id, "Uno"))?.name).toBe("Uno");
    await expect(repo.renameFolder(f1.id, "two")).rejects.toThrow(repo.InputError);
  });
  it("links a note to a task, an event and a goal, and cleans up when they go", async () => {
    const n = await repo.createNote({ title: "Plan" });
    const t = await repo.createTodo({ title: "Do it" });
    const e = await repo.createEvent({ title: "Meet", start: "2026-11-12T10:00:00+07:00" });
    const g = await repo.createGoal({ title: "Goal", horizon: "short" });
    await repo.linkNote(n.id, { entity_type: "task", entity_id: t.id });
    await repo.linkNote(n.id, { entity_type: "task", entity_id: t.id });
    await repo.linkNote(n.id, { entity_type: "event", entity_id: e.id });
    await repo.linkNote(n.id, { entity_type: "goal", entity_id: g.id });
    const d = await repo.getNoteDetail(n.id);
    expect(d?.links.tasks.map((x) => x.id)).toEqual([t.id]);
    expect(d?.links.events.map((x) => x.id)).toEqual([e.id]);
    expect(d?.links.goals.map((x) => x.id)).toEqual([g.id]);
    expect(d?.event_id).toBe(e.id);
    await expect(repo.linkNote(n.id, { entity_type: "task", entity_id: "nope" })).rejects.toThrow(repo.InputError);
    await repo.deleteTodo(t.id);
    await repo.deleteEvent(e.id);
    const after = await repo.getNoteDetail(n.id);
    expect(after?.links.tasks).toEqual([]);
    expect(after?.links.events).toEqual([]);
    expect(after?.event_id).toBeNull();
    expect(await repo.unlinkNote(n.id, { entity_type: "goal", entity_id: g.id })).toBe(true);
  });
});
