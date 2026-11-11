import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/server/repo";
import { handleMcpPost } from "@/lib/server/mcp/handler";
import { approvePending, rejectPending, riskOf } from "@/lib/server/mcp/gate";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await handleMcpPost(
    new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }),
  );
  const body = (await res.json()) as { result: { content: { text: string }[] } };
  return JSON.parse(body.result.content[0].text);
}

describe("which actions wait for approval", () => {
  it("gates deletes, edits and links; lets creates and ticks through", () => {
    expect(riskOf("delete_note", { id: "1" })).toBe("delete");
    expect(riskOf("update_note", { id: "1", title: "x" })).toBe("edit");
    expect(riskOf("link_note", { id: "1" })).toBe("link");
    expect(riskOf("skip_event_occurrence", { id: "1", day: "2026-11-11" })).toBe("edit");
    expect(riskOf("create_note", { title: "x" })).toBeNull();
    expect(riskOf("check_in_habit", { id: "1" })).toBeNull();
    expect(riskOf("update_todo", { id: "1", done: true })).toBeNull();
    expect(riskOf("update_todo", { id: "1", status: "doing" })).toBeNull();
    expect(riskOf("update_todo", { id: "1", done: true, title: "new" })).toBe("edit");
    expect(riskOf("update_goal", { id: "1", status: "done" })).toBe("edit");
  });
});

describe("approval flow through the MCP handler", () => {
  it("queues a delete instead of running it, then runs it on approval", async () => {
    const n = await repo.createNote({ title: "Old groceries" });
    const r = await rpc("delete_note", { id: n.id });
    expect(r.queued).toBe(true);
    expect(r.summary).toBe("Delete note “Old groceries”");
    expect(await repo.getNote(n.id)).not.toBeNull(); // still there
    expect((await repo.listPending()).map((p) => p.id)).toEqual([r.pending_id]);

    const done = await approvePending(r.pending_id, "+07:00");
    expect(done?.status).toBe("approved");
    expect(await repo.getNote(n.id)).toBeNull();
    expect(await repo.countPending()).toBe(0);
    const log = await repo.listAudit();
    expect(log.map((l) => [l.actor, l.summary])).toEqual([
      ["you", "Approved: Delete note “Old groceries”"],
      ["claude", "Asked to: Delete note “Old groceries”"],
    ]);
  });

  it("rejecting leaves the data alone", async () => {
    const n = await repo.createNote({ title: "Keep me" });
    const r = await rpc("update_note", { id: n.id, title: "Renamed" });
    expect(r.summary).toContain("Edit note “Keep me”: title → Renamed");
    expect((await rejectPending(r.pending_id))?.status).toBe("rejected");
    expect((await repo.getNote(n.id))?.title).toBe("Keep me");
    expect(await approvePending(r.pending_id, "+07:00")).toBeNull(); // already decided
  });

  it("asking twice for the same change queues it once", async () => {
    const n = await repo.createNote({ title: "x" });
    const a = await rpc("delete_note", { id: n.id });
    const b = await rpc("delete_note", { id: n.id });
    expect(b.pending_id).toBe(a.pending_id);
    expect(await repo.countPending()).toBe(1);
  });

  it("runs creates and ticks at once and logs them", async () => {
    const c = await rpc("create_todo", { title: "Email the professor" });
    expect(c.created.title).toBe("Email the professor");
    const t = await rpc("update_todo", { id: c.created.id, done: true });
    expect(t.updated.done).toBe(true);
    expect(await repo.countPending()).toBe(0);
    const log = (await repo.listAudit()).map((l) => l.summary);
    expect(log).toContain("Created task “Email the professor”");
    expect(log.some((s) => s.startsWith("Updated task"))).toBe(true);
  });

  it("does not log reads", async () => {
    await rpc("get_summary");
    expect(await repo.listAudit()).toEqual([]);
  });

  it("marks an approval failed when the item is already gone", async () => {
    const n = await repo.createNote({ title: "Gone soon" });
    const r = await rpc("update_note", { id: n.id, title: "New" });
    await repo.deleteNote(n.id);
    const p = await approvePending(r.pending_id, "+07:00");
    expect(p?.status).toBe("failed");
    expect(p?.note).toBeTruthy();
  });

  it("expires requests older than a week", async () => {
    const n = await repo.createNote({ title: "x" });
    const r = await rpc("delete_note", { id: n.id });
    const { ctx } = await import("@/modules/core");
    const { db } = await ctx();
    await db.prepare("UPDATE pending_actions SET created_at = ? WHERE id = ?").bind(new Date(Date.now() - 8 * 86_400_000).toISOString(), r.pending_id).run();
    expect(await repo.countPending()).toBe(0);
    expect((await repo.getPending(r.pending_id))?.status).toBe("expired");
    expect(await approvePending(r.pending_id, "+07:00")).toBeNull();
  });
});
