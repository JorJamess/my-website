import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as repo from "@/lib/server/repo";
import { buildSnapshot, parseSnapshot, restoreSnapshot } from "@/lib/backup-core";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

describe("priority, status and done stay consistent", () => {
  it("done and status are one fact", async () => {
    const t = await repo.createTodo({ title: "Homework" });
    expect(t).toMatchObject({ status: "todo", priority: 0, done: false });
    const doing = await repo.updateTodo(t.id, { status: "doing" });
    expect(doing).toMatchObject({ status: "doing", done: false });
    const done = await repo.updateTodo(t.id, { done: true });
    expect(done).toMatchObject({ status: "done", done: true });
    expect(done?.done_at).toBeTruthy();
    const back = await repo.updateTodo(t.id, { done: false });
    expect(back).toMatchObject({ status: "todo", done: false, done_at: null });
    const viaStatus = await repo.updateTodo(t.id, { status: "done" });
    expect(viaStatus?.done).toBe(true);
  });
  it("keeps 'doing' when a doing task is un-done", async () => {
    const t = await repo.createTodo({ title: "x", status: "doing" });
    expect((await repo.updateTodo(t.id, { done: false }))?.status).toBe("doing");
  });
  it("maps priority names to numbers and keeps important in sync", async () => {
    const t = await repo.createTodo({ title: "x", priority: "medium" });
    expect(t.priority).toBe(2);
    expect(t.important).toBe(false);
    const hi = await repo.updateTodo(t.id, { priority: "high" });
    expect(hi).toMatchObject({ priority: 3, important: true });
    const legacy = await repo.updateTodo(t.id, { important: false });
    expect(legacy?.priority).toBe(0);
    expect((await repo.createTodo({ title: "star", important: true })).priority).toBe(3);
  });
  it("orders by priority before due date", async () => {
    await repo.createTodo({ title: "low soon", priority: "low", due_date: "2026-11-10" });
    await repo.createTodo({ title: "high later", priority: "high", due_date: "2026-12-01" });
    await repo.createTodo({ title: "medium", priority: "medium" });
    expect((await repo.listTodos()).map((t) => t.title)).toEqual(["high later", "medium", "low soon"]);
  });
});

describe("categories", () => {
  it("creates a category by name once and reuses it case-insensitively", async () => {
    const a = await repo.createTodo({ title: "a", category: "Study" });
    const b = await repo.createTodo({ title: "b", category: "study" });
    expect(a.category?.id).toBe(b.category?.id);
    expect((await repo.listCategories()).length).toBe(1);
    expect(a.category?.name).toBe("Study");
  });
  it("filters by category and removes it without deleting tasks", async () => {
    const a = await repo.createTodo({ title: "a", category: "Study" });
    await repo.createTodo({ title: "b", category: "Gym" });
    expect((await repo.listTodos({ category: "study" })).map((t) => t.title)).toEqual(["a"]);
    await repo.deleteCategory(a.category!.id);
    expect((await repo.getTodo(a.id))?.category).toBeNull();
    expect((await repo.listCategories()).map((c) => c.name)).toEqual(["Gym"]);
  });
  it("clears a category with null and renames", async () => {
    const t = await repo.createTodo({ title: "a", category: "Study" });
    expect((await repo.updateTodo(t.id, { category: null }))?.category).toBeNull();
    const c = await repo.createCategory({ name: "Gym", color: "green" });
    const r = await repo.updateCategory(c.id, { name: "Fitness" });
    expect(r).toMatchObject({ name: "Fitness", color: "green" });
    await repo.createCategory({ name: "Study" });
    await expect(repo.updateCategory(c.id, { name: "study" })).rejects.toThrow(repo.InputError);
  });
});

describe("subtasks", () => {
  it("creates one level of subtasks and refuses deeper nesting", async () => {
    const p = await repo.createTodo({ title: "Report" });
    const s = await repo.createTodo({ title: "Intro", parent_id: p.id });
    expect(s.parent_id).toBe(p.id);
    await expect(repo.createTodo({ title: "deep", parent_id: s.id })).rejects.toThrow(repo.InputError);
    await expect(repo.createTodo({ title: "orphan", parent_id: "nope" })).rejects.toThrow(repo.InputError);
  });
  it("deleting a parent deletes its subtasks", async () => {
    const p = await repo.createTodo({ title: "Report" });
    const s = await repo.createTodo({ title: "Intro", parent_id: p.id });
    await repo.deleteTodo(p.id);
    expect(await repo.getTodo(s.id)).toBeNull();
  });
  it("the summary counts and lists only top-level open tasks", async () => {
    const p = await repo.createTodo({ title: "Report" });
    await repo.createTodo({ title: "Intro", parent_id: p.id });
    const s = await repo.getSummary(7);
    expect(s.todos.map((t) => t.title)).toEqual(["Report"]);
    expect(s.counts.todosOpen).toBe(1);
  });
  it("lists the subtasks of a parent", async () => {
    const p = await repo.createTodo({ title: "Report" });
    await repo.createTodo({ title: "Intro", parent_id: p.id });
    await repo.createTodo({ title: "Other" });
    expect((await repo.listTodos({ parentId: p.id })).map((t) => t.title)).toEqual(["Intro"]);
    expect((await repo.listTodos({ parentId: null })).length).toBe(2);
  });
});

describe("backup", () => {
  it("round-trips categories, priority and subtasks", async () => {
    const env = freshEnv();
    const p = await repo.createTodo({ title: "Report", priority: "high", category: "Study" });
    await repo.createTodo({ title: "Intro", parent_id: p.id });
    const snap = JSON.parse(JSON.stringify(await buildSnapshot(env.DB, "manual")));
    await repo.deleteTodo(p.id);
    await restoreSnapshot(env.DB, parseSnapshot(snap));
    const all = await repo.listTodos();
    const parent = all.find((t) => t.title === "Report")!;
    expect(parent).toMatchObject({ priority: 3, category: { name: "Study" } });
    expect(all.find((t) => t.title === "Intro")?.parent_id).toBe(parent.id);
  });
});

describe("migration 0008 on existing data", () => {
  it("backfills priority and status from the old star and done flags", () => {
    const db = new DatabaseSync(":memory:");
    const dir = join(process.cwd(), "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files.filter((f) => f < "0008")) db.exec(readFileSync(join(dir, f), "utf8"));
    const ins = db.prepare("INSERT INTO todos (id, title, important, done, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x')");
    ins.run("a", "starred", 1, 0);
    ins.run("b", "finished", 0, 1);
    ins.run("c", "plain", 0, 0);
    db.exec(readFileSync(join(dir, files.find((f) => f.startsWith("0008"))!), "utf8"));
    const rows = db.prepare("SELECT id, priority, status FROM todos ORDER BY id").all() as { id: string; priority: number; status: string }[];
    expect(rows.map((r) => [r.id, r.priority, r.status])).toEqual([
      ["a", 3, "todo"],
      ["b", 0, "done"],
      ["c", 0, "todo"],
    ]);
  });
});
