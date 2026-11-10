import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { buildSnapshot, listSnapshots, parseSnapshot, previewRestore, restoreSnapshot, RestoreError, saveSnapshot } from "@/lib/backup-core";
import { freshEnv } from "./helpers/env";

function fakeKv() {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    put: async (k: string, v: string, o?: { metadata?: unknown }) => void store.set(k, { value: v, metadata: o?.metadata }),
    get: async (k: string) => store.get(k)?.value ?? null,
    list: async () => ({ keys: [...store].map(([name, v]) => ({ name, metadata: v.metadata })) }),
  } as unknown as KVNamespace;
}

beforeEach(() => {
  freshEnv();
});

describe("backups", () => {
  it("snapshots events, notes and to-dos", async () => {
    const env = freshEnv();
    await repo.createEvent({ title: "E", start: "2026-11-12 09:00" });
    await repo.createNote({ title: "N" });
    await repo.createTodo({ title: "T" });
    const snap = await buildSnapshot(env.DB, "manual");
    expect(snap.tables.events?.length).toBe(1);
    expect(snap.tables.notes?.length).toBe(1);
    expect(snap.tables.todos?.length).toBe(1);
  });
  it("saves and lists snapshots with counts", async () => {
    const env = freshEnv();
    await repo.createNote({ title: "N" });
    const kv = fakeKv();
    const saved = await saveSnapshot(env.DB, kv, "weekly");
    expect(saved.notes).toBe(1);
    const list = await listSnapshots(kv);
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe("weekly");
  });
});

describe("restore", () => {
  it("round-trips data, including recurring events and note links", async () => {
    const env = freshEnv();
    const e = await repo.createEvent({ title: "Gym", start: "2026-11-09 18:00", repeat_days: [1, 3], repeat_until: "2026-12-01" });
    await repo.createNote({ title: "Minutes", content: 'tricky "quotes" \\ and {"json":true}', event_id: e.id });
    await repo.createTodo({ title: "Java", due_date: "2026-11-10", important: true });
    const snap = JSON.parse(JSON.stringify(await buildSnapshot(env.DB, "manual")));

    // change everything, then restore
    await repo.deleteEvent(e.id);
    await repo.createTodo({ title: "extra" });
    await restoreSnapshot(env.DB, parseSnapshot(snap));

    const events = await repo.listEvents({ from: "2026-11-01", to: "2026-12-31" });
    expect(events.length).toBe(7); // Mondays 9,16,23,30 + Wednesdays 11,18,25
    expect((await repo.getEvent(e.id))?.repeat_days).toEqual([1, 3]);
    const notes = await repo.listNotes();
    expect(notes[0].content).toBe('tricky "quotes" \\ and {"json":true}');
    expect(notes[0].event_id).toBe(e.id);
    const todos = await repo.listTodos();
    expect(todos.map((t) => t.title)).toEqual(["Java"]);
    expect(todos[0].important).toBe(true);
  });

  it("leaves tables that are absent from an older backup untouched", async () => {
    const env = freshEnv();
    await repo.createTodo({ title: "keep me" });
    const old = parseSnapshot({
      app: "jameswebpupu",
      version: 1,
      created_at: "2026-01-01T00:00:00Z",
      reason: "weekly",
      tables: { events: [], notes: [] },
    });
    await restoreSnapshot(env.DB, old);
    expect((await repo.listTodos()).length).toBe(1);
  });

  it("restores a backup made before repeat columns existed", async () => {
    const env = freshEnv();
    const old = parseSnapshot({
      app: "jameswebpupu",
      version: 1,
      created_at: "2026-01-01T00:00:00Z",
      reason: "weekly",
      tables: {
        events: [
          { id: "a", title: "Old", description: null, location: null, start_at: "2026-11-12T02:00:00.000Z", end_at: null, all_day: 0, color: "blue", done: 0, created_at: "x", updated_at: "x" },
        ],
      },
    });
    await restoreSnapshot(env.DB, old);
    const e = await repo.getEvent("a");
    expect(e?.title).toBe("Old");
    expect(e?.repeat_days).toBeNull();
  });

  it("rejects wrong files, unknown tables and unknown columns", async () => {
    const env = freshEnv();
    expect(() => parseSnapshot({ hello: 1 })).toThrow(RestoreError);
    expect(() => parseSnapshot({ app: "jameswebpupu", version: 1, tables: { users: [] } })).toThrow(RestoreError);
    const sneaky = parseSnapshot({ app: "jameswebpupu", version: 1, tables: { todos: [{ id: "1", "title\") ; DROP TABLE events; --": "x" }] } });
    await expect(restoreSnapshot(env.DB, sneaky)).rejects.toThrow(RestoreError);
    // the events table must still exist
    await expect(repo.listEvents({ from: "2026-11-01", to: "2026-12-01" })).resolves.toEqual([]);
  });

  it("is atomic: a bad row leaves current data intact", async () => {
    const env = freshEnv();
    await repo.createTodo({ title: "survivor" });
    const bad = parseSnapshot({
      app: "jameswebpupu",
      version: 1,
      tables: { todos: [{ id: "1", title: "ok", created_at: "x", updated_at: "x" }, { id: "2", title: null, created_at: "x", updated_at: "x" }] },
    });
    await expect(restoreSnapshot(env.DB, bad)).rejects.toThrow();
    expect((await repo.listTodos()).map((t) => t.title)).toEqual(["survivor"]);
  });

  it("previews counts without changing anything", async () => {
    const env = freshEnv();
    await repo.createTodo({ title: "a" });
    const snap = parseSnapshot(JSON.parse(JSON.stringify(await buildSnapshot(env.DB, "manual"))));
    await repo.createTodo({ title: "b" });
    const p = await previewRestore(env.DB, snap);
    expect(p.find((x) => x.table === "todos")).toEqual({ table: "todos", current: 2, incoming: 1 });
    expect((await repo.listTodos()).length).toBe(2);
  });

  it("handles a large backup in several chunks", async () => {
    const env = freshEnv();
    const rows = Array.from({ length: 300 }, (_, i) => ({
      id: `n${i}`, title: `Note ${i}`, content: "x".repeat(2000), note_date: null, event_id: null, pinned: 0, created_at: "x", updated_at: "x",
    }));
    await restoreSnapshot(env.DB, parseSnapshot({ app: "jameswebpupu", version: 1, tables: { notes: rows } }));
    expect((await repo.listNotes({ limit: 500 })).length).toBe(300);
  });
});
