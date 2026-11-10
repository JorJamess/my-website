import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { computeProgress, daysLeft } from "@/modules/goals/repo";
import { buildSnapshot, parseSnapshot, restoreSnapshot } from "@/lib/backup-core";
import { addDaysKey, localDateKey } from "@/lib/time";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});
const today = () => localDateKey();

describe("progress maths", () => {
  it("is done over total across milestones and tasks, or null with nothing to measure", () => {
    expect(computeProgress({ done: 0, total: 0 }, { done: 0, total: 0 }).percent).toBeNull();
    expect(computeProgress({ done: 3, total: 5 }, { done: 5, total: 5 }).percent).toBe(8 / 10);
    expect(computeProgress({ done: 0, total: 2 }, { done: 0, total: 0 }).percent).toBe(0);
  });
  it("counts days left, negative once past", () => {
    expect(daysLeft("2026-11-20", "2026-11-10")).toBe(10);
    expect(daysLeft("2026-11-05", "2026-11-10")).toBe(-5);
    expect(daysLeft(null, "2026-11-10")).toBeNull();
  });
});

describe("goals", () => {
  it("creates, updates and deletes", async () => {
    const g = await repo.createGoal({ title: " Learn Japanese N4 ", horizon: "long", priority: "high", category: "Study", target_date: addDaysKey(today(), 90) });
    expect(g).toMatchObject({ title: "Learn Japanese N4", horizon: "long", priority: 3, status: "active", category: { name: "Study" } });
    const u = await repo.updateGoal(g.id, { title: "JLPT N4", priority: "medium" });
    expect(u).toMatchObject({ title: "JLPT N4", priority: 2 });
    expect(await repo.deleteGoal(g.id)).toBe(true);
    expect(await repo.getGoal(g.id)).toBeNull();
  });
  it("sets and clears completed_at with the status", async () => {
    const g = await repo.createGoal({ title: "x" });
    const done = await repo.updateGoal(g.id, { status: "done" });
    expect(done?.completed_at).toBeTruthy();
    expect((await repo.updateGoal(g.id, { status: "active" }))?.completed_at).toBeNull();
  });
  it("rejects a target date before the start date and bad dates", async () => {
    await expect(repo.createGoal({ title: "x", start_date: "2026-11-10", target_date: "2026-11-01" })).rejects.toThrow(repo.InputError);
    await expect(repo.createGoal({ title: "x", target_date: "2026-13-40" })).rejects.toThrow(repo.InputError);
    const g = await repo.createGoal({ title: "ok", start_date: "2026-11-10" });
    await expect(repo.updateGoal(g.id, { target_date: "2026-10-01" })).rejects.toThrow(repo.InputError);
  });
  it("lists active and paused by default, ordered by priority then target date", async () => {
    await repo.createGoal({ title: "low", priority: "low" });
    await repo.createGoal({ title: "high later", priority: "high", target_date: "2027-01-01" });
    await repo.createGoal({ title: "high sooner", priority: "high", target_date: "2026-12-01" });
    await repo.createGoal({ title: "finished", status: "done" });
    expect((await repo.listGoals()).map((g) => g.title)).toEqual(["high sooner", "high later", "low"]);
    expect((await repo.listGoals({ status: "done" })).map((g) => g.title)).toEqual(["finished"]);
    expect((await repo.listGoals({ includeInactive: true })).length).toBe(4);
  });
  it("flags an active goal past its target date as overdue", async () => {
    const g = await repo.createGoal({ title: "late", target_date: addDaysKey(today(), -3) });
    expect(g).toMatchObject({ overdue: true, days_left: -3 });
    expect((await repo.updateGoal(g.id, { status: "paused" }))?.overdue).toBe(false);
  });
  it("keeps goal categories separate from task categories", async () => {
    const t = await repo.createTodo({ title: "t", category: "Study" });
    const g = await repo.createGoal({ title: "g", category: "Study" });
    expect(g.category?.id).not.toBe(t.category?.id);
    expect((await repo.listCategories()).length).toBe(1); // tasks only
  });
});

describe("milestones", () => {
  it("adds in order, ticks, unticks, edits and deletes", async () => {
    const g = await repo.createGoal({ title: "x" });
    const a = await repo.addMilestone(g.id, { title: "Grammar 1-10" });
    const b = await repo.addMilestone(g.id, { title: "Vocabulary", due_date: "2026-12-01" });
    expect([a.sort_order, b.sort_order]).toEqual([0, 1]);
    expect((await repo.updateMilestone(a.id, { done: true }))?.done_at).toBeTruthy();
    expect((await repo.getGoal(g.id))?.progress.milestones).toEqual({ done: 1, total: 2 });
    expect((await repo.updateMilestone(a.id, { done: false }))?.done_at).toBeNull();
    expect((await repo.updateMilestone(b.id, { title: "Vocab 500", due_date: null }))).toMatchObject({ title: "Vocab 500", due_date: null });
    expect(await repo.deleteMilestone(b.id)).toBe(true);
    expect((await repo.listMilestones(g.id)).length).toBe(1);
  });
  it("needs an existing goal", async () => {
    await expect(repo.addMilestone("nope", { title: "x" })).rejects.toThrow(repo.InputError);
  });
});

describe("links", () => {
  it("links tasks, habits, events and notes and reports them in the detail", async () => {
    const g = await repo.createGoal({ title: "Learn Japanese" });
    const task = await repo.createTodo({ title: "20 words" });
    const habit = await repo.createHabit({ title: "Study daily", schedule_type: "daily" });
    await repo.setCheckin(habit.id);
    const event = await repo.createEvent({ title: "Lesson", start: `${today()} 18:00` });
    const note = await repo.createNote({ title: "Grammar" });
    for (const [entity_type, entity_id] of [["task", task.id], ["habit", habit.id], ["event", event.id], ["note", note.id]] as const) {
      await repo.linkToGoal(g.id, { entity_type, entity_id });
    }
    const d = await repo.getGoalDetail(g.id);
    expect(d?.link_counts).toEqual({ task: 1, habit: 1, event: 1, note: 1 });
    expect(d?.links.tasks.map((t) => t.title)).toEqual(["20 words"]);
    expect(d?.links.habits[0]).toMatchObject({ title: "Study daily", current_streak: 1 });
    expect(d?.links.events[0].title).toBe("Lesson");
    expect(d?.links.notes[0].title).toBe("Grammar");
  });
  it("is idempotent and refuses things that don't exist", async () => {
    const g = await repo.createGoal({ title: "x" });
    const t = await repo.createTodo({ title: "t" });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    expect((await repo.getGoal(g.id))?.link_counts.task).toBe(1);
    await expect(repo.linkToGoal(g.id, { entity_type: "task", entity_id: "nope" })).rejects.toThrow(repo.InputError);
    await expect(repo.linkToGoal(g.id, { entity_type: "habit", entity_id: "nope" })).rejects.toThrow(repo.InputError);
    await expect(repo.linkToGoal("nope", { entity_type: "task", entity_id: t.id })).rejects.toThrow(repo.InputError);
  });
  it("unlinks without deleting the item", async () => {
    const g = await repo.createGoal({ title: "x" });
    const t = await repo.createTodo({ title: "t" });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    expect(await repo.unlinkFromGoal(g.id, { entity_type: "task", entity_id: t.id })).toBe(true);
    expect(await repo.unlinkFromGoal(g.id, { entity_type: "task", entity_id: t.id })).toBe(false);
    expect(await repo.getTodo(t.id)).not.toBeNull();
  });
  it("counts linked tasks in the progress and follows their done state", async () => {
    const g = await repo.createGoal({ title: "x" });
    const m = await repo.addMilestone(g.id, { title: "m" });
    const t1 = await repo.createTodo({ title: "t1" });
    const t2 = await repo.createTodo({ title: "t2" });
    for (const t of [t1, t2]) await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    await repo.updateTodo(t1.id, { done: true });
    await repo.updateMilestone(m.id, { done: true });
    const p = (await repo.getGoal(g.id))!.progress;
    expect(p.tasks).toEqual({ done: 1, total: 2 });
    expect(p.percent).toBe(2 / 3);
  });
  it("removes the link when the linked item is deleted", async () => {
    const g = await repo.createGoal({ title: "x" });
    const t = await repo.createTodo({ title: "t" });
    const h = await repo.createHabit({ title: "h", schedule_type: "daily" });
    const e = await repo.createEvent({ title: "e", start: `${today()} 09:00` });
    const n = await repo.createNote({ title: "n" });
    for (const [entity_type, entity_id] of [["task", t.id], ["habit", h.id], ["event", e.id], ["note", n.id]] as const) {
      await repo.linkToGoal(g.id, { entity_type, entity_id });
    }
    await repo.deleteTodo(t.id);
    await repo.deleteHabit(h.id);
    await repo.deleteEvent(e.id);
    await repo.deleteNote(n.id);
    expect((await repo.getGoal(g.id))?.link_counts).toEqual({ task: 0, habit: 0, event: 0, note: 0 });
    expect((await repo.getGoalDetail(g.id))?.links.tasks).toEqual([]);
  });
  it("deleting a parent task also drops links to its subtasks", async () => {
    const g = await repo.createGoal({ title: "x" });
    const p = await repo.createTodo({ title: "parent" });
    const s = await repo.createTodo({ title: "sub", parent_id: p.id });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: s.id });
    await repo.deleteTodo(p.id);
    expect((await repo.getGoal(g.id))?.link_counts.task).toBe(0);
  });
  it("deleting a goal keeps what was linked and removes its milestones", async () => {
    const g = await repo.createGoal({ title: "x" });
    const t = await repo.createTodo({ title: "t" });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    await repo.addMilestone(g.id, { title: "m" });
    await repo.deleteGoal(g.id);
    expect(await repo.getTodo(t.id)).not.toBeNull();
    expect(await repo.listMilestones(g.id)).toEqual([]);
  });
});

describe("summary and backup", () => {
  it("shows the top active goals on the summary", async () => {
    await repo.createGoal({ title: "a", priority: "high" });
    await repo.createGoal({ title: "b" });
    await repo.createGoal({ title: "done", status: "done" });
    const s = await repo.getSummary(7);
    expect(s.goalsActive.map((g) => g.title)).toEqual(["a", "b"]);
  });
  it("round-trips goals, milestones and links", async () => {
    const env = freshEnv();
    const g = await repo.createGoal({ title: "x", category: "Study" });
    await repo.addMilestone(g.id, { title: "m" });
    const t = await repo.createTodo({ title: "t" });
    await repo.linkToGoal(g.id, { entity_type: "task", entity_id: t.id });
    const snap = JSON.parse(JSON.stringify(await buildSnapshot(env.DB, "manual")));
    await repo.deleteGoal(g.id);
    await restoreSnapshot(env.DB, parseSnapshot(snap));
    const d = await repo.getGoalDetail(g.id);
    expect(d?.category?.name).toBe("Study");
    expect(d?.milestones.length).toBe(1);
    expect(d?.links.tasks.length).toBe(1);
  });
});
