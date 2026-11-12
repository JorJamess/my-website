import { beforeEach, describe, expect, it } from "vitest";
import { handleMcpPost } from "@/lib/server/mcp/handler";
import { approvePending } from "@/lib/server/mcp/gate";
import * as repo from "@/lib/server/repo";
import { proposalsEnabled, revokeDocument, setProposalsEnabled, upload, type UploadInput } from "@/modules/obsidian/documents";
import { createPairingCode, completePairing } from "@/modules/obsidian/devices";
import { freshEnv } from "./helpers/env";

const KEY = btoa("0123456789abcdef0123456789abcdef");
let env: CloudflareEnv;
beforeEach(async () => {
  env = freshEnv({ OBSIDIAN_PAYLOAD_KEY: KEY });
  await setProposalsEnabled(true); // proposals are off by default; most tests need them
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await handleMcpPost(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content[0].text;
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: !!body.result.isError, data, text };
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (n: number, over: Partial<UploadInput> = {}): UploadInput => ({ id: ID(n), kind: "note", title: `Note ${n}`, path: `Programming/Java/Note ${n}.md`, content_hash: `hash-of-note-${n}`, tags: ["java"], grant_version: 0, sync_version: 1, total_chunks: 1, chunks: [{ index: 0, heading: "Intro", content: `Java OOP note ${n} explains polymorphism.` }], ...over });

describe("tool list", () => {
  it("lists the Obsidian tools, reads marked read-only, nothing removed", async () => {
    const res = await handleMcpPost(new Request("http://x", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    const tools = ((await res.json()) as { result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] } }).result.tools;
    const names = tools.map((t) => t.name);
    for (const n of ["search_obsidian_knowledge", "read_obsidian_note", "read_obsidian_pdf", "obsidian_status", "propose_create_note", "propose_edit_note", "propose_rename_note", "propose_move_note", "propose_delete_note", "propose_create_folder", "propose_rename_folder", "propose_move_folder", "propose_delete_folder"]) expect(names).toContain(n);
    for (const n of ["get_summary", "create_note", "delete_note", "search_all"]) expect(names).toContain(n);
    expect(tools.find((t) => t.name === "read_obsidian_note")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "propose_delete_note")!.annotations?.readOnlyHint).toBeUndefined();
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("reading shared knowledge", () => {
  it("searches in Thai, English and code, with sources, and never sees unshared notes", async () => {
    await completePairing({ code: (await createPairingCode()).code, name: "Mac", vault_name: "James Knowledge" });
    await upload("d", doc(1));
    await upload("d", doc(2, { title: "ภาษาไทย", path: "Languages/Thai.md", chunks: [{ index: 0, content: "การเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลัก" }] }));
    await upload("d", doc(3, { path: "Web/React.md", chunks: [{ index: 0, content: "Call useEffect after render" }] }));
    const en = await call("search_obsidian_knowledge", { query: "polymorphism" });
    expect(en.data.results[0]).toMatchObject({ document_id: ID(1), title: "Note 1", type: "note", source_path: "Programming/Java/Note 1.md", section: "Intro", tags: ["java"] });
    expect(en.data.results[0].obsidian_link).toBe("obsidian://open?vault=James%20Knowledge&file=Programming%2FJava%2FNote%201");
    expect(en.data.coverage).toMatch(/ซิงก์แล้ว/);
    expect((await call("search_obsidian_knowledge", { query: "โปรแกรม" })).data.results[0].title).toBe("ภาษาไทย");
    expect((await call("search_obsidian_knowledge", { query: "useEffect" })).data.results[0].title).toBe("Note 3");
    expect((await call("search_obsidian_knowledge", { query: "my private diary" })).data.results).toEqual([]);
    expect((await call("search_obsidian_knowledge", { query: "x".repeat(300) })).isError).toBe(true);
  });
  it("reads a note with a content hash, in bounded pieces", async () => {
    await upload("d", doc(1, { total_chunks: 10, chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, content: "w".repeat(3900) })) }));
    const r = await call("read_obsidian_note", { id: ID(1), max_chars: 10_000 });
    expect(r.data).toMatchObject({ document_id: ID(1), title: "Note 1", source_path: "Programming/Java/Note 1.md", content_hash: "hash-of-note-1", truncated: true, total_chunks: 10 });
    expect(r.data.note).toMatch(/บางส่วน/);
    const next = await call("read_obsidian_note", { id: ID(1), from_chunk: r.data.next_chunk, max_chars: 40_000 });
    expect(next.data.truncated).toBe(false);
    expect(next.data.note).toMatch(/ครบ/);
  });
  it("reads PDF text by page and says what it cannot read", async () => {
    const pdf = "pdf:" + "a".repeat(32);
    await upload("d", { ...doc(10, { id: pdf, kind: "pdf", title: "Database lecture", path: "Uni/db.pdf", total_chunks: 2, chunks: [{ index: 0, page: 1, content: "Normalization removes redundancy" }, { index: 1, page: 2, content: "Transactions are ACID" }] }), pdf: { state: "completed", pages: 2 } });
    const hit = (await call("search_obsidian_knowledge", { query: "ACID" })).data.results[0];
    expect(hit).toMatchObject({ type: "pdf", page: 2, source_path: "Uni/db.pdf" });
    const r = await call("read_obsidian_pdf", { id: pdf, page_from: 1, page_to: 1 });
    expect(r.data.pages).toEqual([{ page: 1, chunk_index: 0, text: "Normalization removes redundancy" }]);
    expect(r.data.note).toMatch(/เนื้อหาที่เป็นภาพ/);
    expect((await call("read_obsidian_note", { id: pdf })).text).toMatch(/read_obsidian_pdf/);
    await upload("d", doc(1));
    expect((await call("read_obsidian_pdf", { id: ID(1) })).text).toMatch(/read_obsidian_note/);
  });
  it("a revoked or unknown note cannot be read or found", async () => {
    await upload("d", doc(1));
    await revokeDocument(ID(1));
    expect((await call("read_obsidian_note", { id: ID(1) })).isError).toBe(true);
    expect((await call("read_obsidian_note", { id: ID(404) })).isError).toBe(true);
    expect((await call("search_obsidian_knowledge", { query: "polymorphism" })).data.results).toEqual([]);
  });
  it("status gives numbers only", async () => {
    await completePairing({ code: (await createPairingCode()).code, name: "James's Mac", vault_name: "James Knowledge" });
    await upload("d", doc(1));
    await upload("d", doc(2, { chunks: [{ index: 0, content: "password = \"hunter2hunter2\"" }] })).catch(() => {});
    const s = await call("obsidian_status");
    expect(s.data).toMatchObject({ search_available: true, synced: { notes: 1, pdfs: 0 }, held_back: { by_secret_scan: 1 }, approvals_configured: true });
    expect(s.data.devices[0]).toMatchObject({ name: "James's Mac", vault: "James Knowledge", status: "active" });
    expect(s.text).not.toContain("hunter2");
    expect(s.text).not.toContain("Note 2");
  });
});

describe("proposals", () => {
  async function pending() {
    return (await env.DB.prepare("SELECT * FROM pending_actions ORDER BY created_at").all<{ id: string; tool: string; risk: string; status: string; summary: string; args: string }>()).results;
  }
  it("create note: queued for approval, not executed, content encrypted and absent from approval rows and audit", async () => {
    const r = await call("propose_create_note", { path: "Programming/Web/REST API.md", content: "# REST API\nVERY-PRIVATE-CONTENT" });
    expect(r.data).toMatchObject({ queued: true, summary: 'Create note “Programming/Web/REST API.md” (31 characters)' });
    const p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ tool: "propose_create_note", risk: "vault", status: "pending" });
    expect(JSON.stringify([p, await repo.listAudit()])).not.toContain("VERY-PRIVATE");
    const cmd = await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands").first<{ status: string; payload_enc: string }>();
    expect(cmd!.status).toBe("awaiting_approval");
    expect(cmd!.payload_enc).not.toContain("PRIVATE");
    // approving only makes it wait for the Mac
    await approvePending(p[0].id, "+07:00");
    expect((await env.DB.prepare("SELECT status FROM obsidian_commands").first())).toEqual({ status: "approved" });
  });
  it("rejects a path that is taken, unsafe, wrong type or too big, and a missing secret key", async () => {
    await upload("d", doc(1));
    expect((await call("propose_create_note", { path: "programming/java/NOTE 1.md", content: "x" })).text).toMatch(/มีโน้ตอยู่/);
    expect((await call("propose_create_note", { path: "../x.md", content: "x" })).isError).toBe(true);
    expect((await call("propose_create_note", { path: ".obsidian/x.md", content: "x" })).isError).toBe(true);
    expect((await call("propose_create_note", { path: "x.txt", content: "x" })).isError).toBe(true);
    expect((await call("propose_create_note", { path: "big.md", content: "x".repeat(900_001) })).isError).toBe(true);
    expect(await pending()).toHaveLength(0);
    freshEnv();
    await setProposalsEnabled(true); // only the missing key should stop it
    expect((await call("propose_create_note", { path: "a.md", content: "x" })).text).toMatch(/OBSIDIAN_PAYLOAD_KEY/);
  });
  it("edit: only for shared notes, and only with the hash that was read", async () => {
    await upload("d", doc(1));
    expect((await call("propose_edit_note", { path: "Programming/Java/Unknown.md", new_content: "x", expected_hash: "hash-of-note-1" })).text).toMatch(/ไม่พบโน้ตที่ซิงก์/);
    expect((await call("propose_edit_note", { path: "Programming/Java/Note 1.md", new_content: "x", expected_hash: "an-old-hash-value" })).text).toMatch(/เปลี่ยนไปแล้ว/);
    const ok = await call("propose_edit_note", { path: "Programming/Java/Note 1.md", new_content: "Rewritten about polymorphism", expected_hash: "hash-of-note-1" });
    expect(ok.data.queued).toBe(true);
    const cmd = await env.DB.prepare("SELECT expected_hash FROM obsidian_commands").first();
    expect(cmd).toEqual({ expected_hash: "hash-of-note-1" });
  });
  it("rename and move keep to their own meaning and refuse an existing destination", async () => {
    await upload("d", doc(1));
    await upload("d", doc(2));
    expect((await call("propose_rename_note", { path: "Programming/Java/Note 1.md", new_path: "Other/Renamed.md" })).text).toMatch(/โฟลเดอร์เดิม/);
    expect((await call("propose_rename_note", { path: "Programming/Java/Note 1.md", new_path: "Programming/Java/Note 2.md" })).text).toMatch(/มีโน้ตอยู่/);
    expect((await call("propose_rename_note", { path: "Programming/Java/Note 1.md", new_path: "Programming/Java/OOP.md" })).data.queued).toBe(true);
    expect((await call("propose_move_note", { path: "Programming/Java/Note 2.md", new_path: "Other/Different name.md" })).text).toMatch(/ชื่อไฟล์เดิม/);
    expect((await call("propose_move_note", { path: "Programming/Java/Note 2.md", new_path: "Programming/Java/Note 2.md" })).isError).toBe(true);
    expect((await call("propose_move_note", { path: "Programming/Java/Note 2.md", new_path: "Archive/Note 2.md" })).data.summary).toBe('Move note “Programming/Java/Note 2.md” to folder “Archive”');
  });
  it("folder operations show only shared items and never say anything about unshared files", async () => {
    await upload("d", doc(1));
    await upload("d", doc(2));
    const pdf = "pdf:" + "b".repeat(32);
    await upload("d", { ...doc(10, { id: pdf, kind: "pdf", title: "L", path: "Programming/Java/lec.pdf", total_chunks: 1, chunks: [{ index: 0, page: 1, content: "pdf text" }] }), pdf: { state: "completed", pages: 1 } });
    // a folder with no shared notes looks like it does not exist
    expect((await call("propose_delete_folder", { path: "Private" })).text).toMatch(/ไม่พบโน้ตที่ซิงก์ในโฟลเดอร์/);
    const del = await call("propose_delete_folder", { path: "Programming/Java" });
    expect(del.data.queued).toBe(true);
    expect(del.data.summary).toMatch(/2 synced notes and 1 PDFs are affected/);
    expect(del.data.summary).toMatch(/not shared/);
    const cmd = await env.DB.prepare("SELECT payload_enc FROM obsidian_commands").first<{ payload_enc: string }>();
    expect(cmd!.payload_enc).toBeTruthy();
    expect((await call("propose_rename_folder", { path: "Programming/Java", new_path: "Programming/Java OOP" })).data.queued).toBe(true);
    expect((await call("propose_rename_folder", { path: "Programming/Java", new_path: "Elsewhere/Java" })).text).toMatch(/ที่เดิม/);
    expect((await call("propose_move_folder", { path: "Programming/Java", new_path: "Programming/Java/Inside/Java" })).isError).toBe(true);
    expect((await call("propose_move_folder", { path: "Programming/Java", new_path: "Archive/Java" })).data.queued).toBe(true);
    expect((await call("propose_create_folder", { path: "Programming/Java" })).text).toMatch(/อยู่แล้ว/);
    expect((await call("propose_create_folder", { path: "Programming/Web" })).data.queued).toBe(true);
    const { previewCommand } = await import("@/modules/obsidian/commands");
    const delPending = (await pending()).find((p) => p.tool === "propose_delete_folder")!;
    const prev = (await previewCommand(delPending.id))!;
    expect(prev.payload).toMatchObject({ path: "Programming/Java", impact: { synced_notes: 2, synced_pdfs: 1, synced_note_paths: ["Programming/Java/Note 1.md", "Programming/Java/Note 2.md"] } });
  });
  it("delete note is queued with a 24 hour life, and the proposal is never executed by the Worker", async () => {
    await upload("d", doc(1));
    const r = await call("propose_delete_note", { path: "Programming/Java/Note 1.md" });
    expect(r.data.message).toMatch(/Mac/);
    const cmd = await env.DB.prepare("SELECT ttl_seconds, status FROM obsidian_commands").first();
    expect(cmd).toEqual({ ttl_seconds: 86400, status: "awaiting_approval" });
    expect((await call("search_obsidian_knowledge", { query: "polymorphism" })).data.results).toHaveLength(1); // still there
  });
  it("existing tools still behave: notes are created at once, deletes wait", async () => {
    const created = await call("create_note", { title: "Plain note", content: "hello" });
    expect(created.isError).toBe(false);
    const del = await call("delete_note", { id: created.data.created.id });
    expect(del.data).toMatchObject({ queued: true });
  });
});

describe("the owner's switch for proposals", () => {
  const list = async () => {
    const res = await handleMcpPost(new Request("http://x", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    return ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  };
  it("is off on a fresh install, and then Claude cannot see or use any propose tool, while reading still works", async () => {
    freshEnv({ OBSIDIAN_PAYLOAD_KEY: KEY });
    expect(await proposalsEnabled()).toBe(false);
    const names = await list();
    expect(names.some((n) => n.startsWith("propose_"))).toBe(false);
    for (const n of ["search_obsidian_knowledge", "read_obsidian_note", "read_obsidian_pdf", "obsidian_status", "get_summary"]) expect(names).toContain(n);
    const r = await call("propose_create_note", { path: "A/new.md", content: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/ปิด/);
    expect((await call("obsidian_status")).data.proposals_enabled).toBe(false);
    expect(await repo.listPending()).toEqual([]);
  });
  it("turning it on shows the tools and queues proposals; turning it off again stops new ones but keeps queued ones", async () => {
    expect((await list()).filter((n) => n.startsWith("propose_")).length).toBe(9);
    const first = await call("propose_create_note", { path: "A/one.md", content: "x" });
    expect(first.isError).toBe(false);
    await setProposalsEnabled(false);
    expect((await list()).some((n) => n.startsWith("propose_"))).toBe(false);
    expect((await call("propose_create_note", { path: "A/two.md", content: "x" })).isError).toBe(true);
    expect((await repo.listPending()).length).toBe(1);
  });
});
