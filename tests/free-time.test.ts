import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { eventInterval, freeSlots, mergeIntervals, overlaps } from "@/lib/scheduling";
import { queryTerms, rankNotes, scoreNote, snippetAround } from "@/lib/notes-rank";
import { tools } from "@/lib/server/mcp/tools";
import { freshEnv } from "./helpers/env";

const MIN = 60_000;
const iv = (a: number, b: number) => ({ start: a * MIN, end: b * MIN });

describe("scheduling maths", () => {
  it("back-to-back is not a clash, overlap is", () => {
    expect(overlaps(iv(0, 60), iv(60, 120))).toBe(false);
    expect(overlaps(iv(0, 60), iv(59, 120))).toBe(true);
  });
  it("gives timed events an hour when no end, and ignores all-day events", () => {
    const e = eventInterval({ start_at: "2026-11-13T03:00:00.000Z", end_at: null, all_day: false });
    expect(e && e.end - e.start).toBe(60 * MIN);
    expect(eventInterval({ start_at: "2026-11-13T00:00:00.000Z", end_at: null, all_day: true })).toBeNull();
  });
  it("merges busy blocks and finds gaps of at least the wanted length", () => {
    expect(mergeIntervals([iv(10, 30), iv(0, 15), iv(40, 50)])).toEqual([iv(0, 30), iv(40, 50)]);
    // window 0-120, busy 10-30 and 40-50 and 100-130 (runs past the window)
    const slots = freeSlots([iv(10, 30), iv(40, 50), iv(100, 130)], 0, 120 * MIN, 15);
    expect(slots).toEqual([iv(50, 100)]); // the 10-minute gaps are too short
    expect(freeSlots([iv(10, 30)], 0, 120 * MIN, 5)).toEqual([iv(0, 10), iv(30, 120)]);
    expect(freeSlots([], 0, 120 * MIN, 30)).toEqual([iv(0, 120)]);
    expect(freeSlots([iv(0, 120)], 0, 120 * MIN, 1)).toEqual([]);
  });
});

describe("note ranking", () => {
  const n = (title: string, content: string, tags: string[] = [], updated = "2026-11-01T00:00:00Z", pinned = false) => ({ title, content, tags, updated_at: updated, pinned });
  it("splits a query into unique lower-case words", () => {
    expect(queryTerms("  Database  NORMALIZATION database ")).toEqual(["database", "normalization"]);
  });
  it("ranks title and tag hits above body hits, and notes with every word above partial ones", () => {
    const terms = queryTerms("python list");
    const body = n("Misc", "python is fun. a list of things");
    const title = n("Python notes", "nothing here");
    const partial = n("Other", "python only");
    const r = rankNotes([partial, body, title], terms).map((x) => x.note.title);
    expect(r).toEqual(["Misc", "Python notes", "Other"]); // both words in the body beat one word in the title
    expect(scoreNote(title, terms)).toBeGreaterThan(scoreNote(partial, terms));
    expect(scoreNote(body, terms)).toBeGreaterThan(scoreNote(partial, terms)); // both words present
    expect(rankNotes([n("x", "nothing")], terms)).toEqual([]);
  });
  it("works for Thai (no spaces between words)", () => {
    expect(scoreNote(n("สรุปภาษาญี่ปุ่น", "คันจิ บทที่ 3"), ["ญี่ปุ่น"])).toBeGreaterThan(0);
  });
  it("makes a snippet around the first hit", () => {
    const text = "a".repeat(200) + " normalization " + "b".repeat(200);
    const s = snippetAround(text, ["normalization"], 80);
    expect(s).toContain("normalization");
    expect(s.startsWith("…")).toBe(true);
  });
});

beforeEach(() => {
  freshEnv();
});

describe("calendar clash and free-time tools", () => {
  it("finds a clash, excludes itself, and skips all-day events", async () => {
    const a = await repo.createEvent({ title: "Class", start: "2026-11-13 10:00", end: "2026-11-13 11:30" });
    await repo.createEvent({ title: "Holiday", start: "2026-11-13", all_day: true });
    expect((await repo.findConflicts("2026-11-13 11:00", "2026-11-13 12:00")).map((e) => e.title)).toEqual(["Class"]);
    expect(await repo.findConflicts("2026-11-13 11:30", "2026-11-13 12:30")).toEqual([]); // starts as it ends
    expect(await repo.findConflicts("2026-11-13 10:30", "2026-11-13 11:00", { excludeId: a.id })).toEqual([]);
  });
  it("sees repeating events and skipped occurrences", async () => {
    // 2026-11-13 is a Friday; repeats on Fridays
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-06 18:00", end: "2026-11-06 19:00", repeat_days: [5] });
    expect((await repo.findConflicts("2026-11-20 18:30", "2026-11-20 19:30")).map((x) => x.title)).toEqual(["Gym"]);
    await repo.skipOccurrence(e.id, "2026-11-20");
    expect(await repo.findConflicts("2026-11-20 18:30", "2026-11-20 19:30")).toEqual([]);
  });
  it("lists free slots between events inside the window", async () => {
    await repo.createEvent({ title: "A", start: "2026-11-13 09:00", end: "2026-11-13 10:00" });
    await repo.createEvent({ title: "B", start: "2026-11-13 13:00", end: "2026-11-13 14:00" });
    const slots = await repo.findFreeSlots({ date: "2026-11-13", minutes: 60, from: "08:00", to: "16:00" });
    expect(slots.map((s) => [s.start_at, s.minutes])).toEqual([
      ["2026-11-13T01:00:00.000Z", 60], // 08:00-09:00
      ["2026-11-13T03:00:00.000Z", 180], // 10:00-13:00
      ["2026-11-13T07:00:00.000Z", 120], // 14:00-16:00
    ]);
    await expect(repo.findFreeSlots({ date: "nope", minutes: 30 })).rejects.toThrow(repo.InputError);
    await expect(repo.findFreeSlots({ date: "2026-11-13", minutes: 30, from: "20:00", to: "09:00" })).rejects.toThrow(repo.InputError);
  });
  it("create_event warns about a clash but still creates", async () => {
    await repo.createEvent({ title: "Class", start: "2026-11-13 10:00", end: "2026-11-13 11:00" });
    const tool = tools.find((t) => t.name === "create_event")!;
    const out = (await tool.run(tool.schema.parse({ title: "Meeting", start: "2026-11-13 10:30", end: "2026-11-13 11:30" }) as never, "+07:00")) as { created: { id: string }; warning?: string; conflicts?: unknown[] };
    expect(out.created.id).toBeTruthy();
    expect(out.warning).toBeTruthy();
    expect(out.conflicts).toHaveLength(1);
  });
});

describe("ranked note search", () => {
  it("ranks, filters by folder and tag, and gives a snippet", async () => {
    await repo.createNote({ title: "Python basics", content: "lists and dicts", folder: "Study", tags: ["python"] });
    await repo.createNote({ title: "Shopping", content: "I should learn python someday" });
    await repo.createNote({ title: "Unrelated", content: "milk" });
    const r = await repo.searchNotesRanked("python");
    expect(r.map((h) => h.note.title)).toEqual(["Python basics", "Shopping"]);
    expect(r[1].snippet).toContain("python");
    expect((await repo.searchNotesRanked("python", { folder: "Study" })).map((h) => h.note.title)).toEqual(["Python basics"]);
    expect((await repo.searchNotesRanked("python", { tag: "python" })).length).toBe(1);
    expect(await repo.searchNotesRanked("   ")).toEqual([]);
  });
  it("matches any word and puts notes with all the words first", async () => {
    await repo.createNote({ title: "DB", content: "database normalization forms" });
    await repo.createNote({ title: "Just database", content: "database" });
    const r = await repo.searchNotesRanked("database normalization");
    expect(r.map((h) => h.note.title)).toEqual(["DB", "Just database"]);
  });
});

describe("stale goals", () => {
  it("lists active goals with no progress for N days, and counts ticks, finished tasks and check-ins as progress", async () => {
    const quiet = await repo.createGoal({ title: "Quiet", horizon: "long" });
    const busy = await repo.createGoal({ title: "Busy", horizon: "short" });
    const m = await repo.addMilestone(busy.id, { title: "step" });
    await repo.updateMilestone(m.id, { done: true });
    const { ctx } = await import("@/modules/core");
    const { db } = await ctx();
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await db.prepare("UPDATE goals SET created_at = ? WHERE id = ?").bind(old, quiet.id).run();
    const stale = await repo.getStaleGoals(14);
    expect(stale.map((g) => g.title)).toEqual(["Quiet"]);
    expect(stale[0].days_since_progress).toBeGreaterThanOrEqual(30);
    // a finished linked task counts
    const t = await repo.createTodo({ title: "do it" });
    await repo.linkToGoal(quiet.id, { entity_type: "task", entity_id: t.id });
    await repo.updateTodo(t.id, { done: true });
    expect(await repo.getStaleGoals(14)).toEqual([]);
  });
});
