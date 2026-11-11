import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

async function seed() {
  await repo.createNote({ title: "Kanji week 3", content: "Japanese grammar", folder: "Study", tags: ["exam"] });
  await repo.createNote({ title: "Japanese groceries", content: "miso" });
  const t = await repo.createTodo({ title: "Japanese homework", due_date: "2026-11-13" });
  await repo.createTodo({ title: "Japanese old", due_date: "2026-10-01" });
  await repo.updateTodo(t.id, { done: true });
  await repo.createEvent({ title: "Japanese class", start: "2026-11-12T10:00:00+07:00" });
  await repo.createGoal({ title: "Learn Japanese N4", horizon: "long" });
  await repo.createHabit({ title: "Japanese flashcards", schedule_type: "daily" });
}

describe("searchAll", () => {
  it("finds across every type and counts each", async () => {
    await seed();
    const r = await repo.searchAll({ q: "japanese" });
    expect(r.counts).toEqual({ notes: 2, tasks: 2, events: 1, goals: 1, habits: 1 });
  });
  it("narrows to chosen types", async () => {
    await seed();
    const r = await repo.searchAll({ q: "japanese", types: ["goals"] });
    expect(r.counts).toMatchObject({ notes: 0, tasks: 0, events: 0, goals: 1 });
  });
  it("filters by date range and status", async () => {
    await seed();
    const r = await repo.searchAll({ q: "japanese", from: "2026-11-01", to: "2026-11-30" });
    expect(r.tasks.map((t) => t.title)).toEqual(["Japanese homework"]);
    expect(r.events.length).toBe(1);
    const done = await repo.searchAll({ q: "japanese", status: "done" });
    expect(done.tasks.map((t) => t.title)).toEqual(["Japanese homework"]);
    expect(done.notes).toEqual([]);
  });
  it("folder and tag narrow to notes, and work without a query", async () => {
    await seed();
    const r = await repo.searchAll({ q: "japanese", folder: "Study" });
    expect(r.notes.map((n) => n.title)).toEqual(["Kanji week 3"]);
    expect(r.counts.tasks).toBe(0);
    const t = await repo.searchAll({ q: "", tag: "exam" });
    expect(t.notes.length).toBe(1);
  });
  it("finds a habit by its description too", async () => {
    await repo.createHabit({ title: "Gym", description: "leg day and cardio", schedule_type: "daily" });
    expect((await repo.searchAll({ q: "cardio" })).habits.map((h) => h.title)).toEqual(["Gym"]);
  });
  it("returns nothing for an empty query without filters", async () => {
    await seed();
    const r = await repo.searchAll({ q: "  " });
    expect(Object.values(r.counts).every((n) => n === 0)).toBe(true);
  });
});
