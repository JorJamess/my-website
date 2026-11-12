// The Mac Bridge talking to the real Worker route handlers (with the test database). No network, no real vault.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, type FetchLike } from "../tools/obsidian-bridge/core/src/cloudflare/client";
import { BridgeService } from "../tools/obsidian-bridge/core/src/service/daemon";
import { MemoryCredentialStore } from "../tools/obsidian-bridge/core/src/security/keychain";
import { emptyState } from "../tools/obsidian-bridge/core/src/sync/state";
import { parseNote } from "../tools/obsidian-bridge/core/src/vault/frontmatter";
import { sha256 } from "../tools/obsidian-bridge/core/src/vault/scan";
import { silentLogger } from "../tools/obsidian-bridge/core/src/logging";
import type { BridgeConfig } from "../tools/obsidian-bridge/core/src/config/config";
import { createPdfExtractor } from "../tools/obsidian-bridge/core/src/pdf/extract";
import * as pairComplete from "@/app/api/obsidian/pair/complete/route";
import * as poll from "@/app/api/obsidian/bridge/poll/route";
import * as docs from "@/app/api/obsidian/bridge/documents/route";
import * as doc from "@/app/api/obsidian/bridge/documents/[id]/route";
import * as docReenable from "@/app/api/obsidian/bridge/documents/[id]/reenable/route";
import * as blocked from "@/app/api/obsidian/bridge/blocked/route";
import * as claim from "@/app/api/obsidian/bridge/commands/[id]/claim/route";
import * as result from "@/app/api/obsidian/bridge/commands/[id]/result/route";
import * as heartbeat from "@/app/api/obsidian/bridge/heartbeat/route";
import * as unpair from "@/app/api/obsidian/bridge/unpair/route";
import { approvePending } from "@/lib/server/mcp/gate";
import * as repo from "@/lib/server/repo";
import { createPairingCode, listDevices, revokeDevice } from "@/modules/obsidian/devices";
import { exceptFinding, listFindings, readDocument, revokeDocument, reenableDocument, searchKnowledge, getObsidianStatus } from "@/modules/obsidian/documents";
import { queueVaultProposal } from "@/modules/obsidian/commands";
import { handleMcpPost } from "@/lib/server/mcp/handler";
import { freshEnv } from "./helpers/env";
import { setProposalsEnabled } from "@/modules/obsidian/documents";

const KEY = btoa("0123456789abcdef0123456789abcdef");
const BASE = "https://lifeos.test";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOTE = (id: string | null, sync: boolean, body: string) => `---\n${id ? `id: ${id}\n` : ""}lifeos_sync: ${sync}\n---\n${body}`;
const HELPER = join(process.cwd(), "tools/obsidian-bridge/core/native/bin/pdf-text");

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTES: [string, RegExp, Handler][] = [
  ["POST", /^\/api\/obsidian\/pair\/complete$/, pairComplete.POST as Handler],
  ["GET", /^\/api\/obsidian\/bridge\/poll$/, poll.GET as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/documents$/, docs.POST as Handler],
  ["DELETE", /^\/api\/obsidian\/bridge\/documents\/([^/]+)$/, doc.DELETE as Handler],
  ["PATCH", /^\/api\/obsidian\/bridge\/documents\/([^/]+)$/, doc.PATCH as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/documents\/([^/]+)\/reenable$/, docReenable.POST as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/blocked$/, blocked.POST as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/commands\/([^/]+)\/claim$/, claim.POST as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/commands\/([^/]+)\/result$/, result.POST as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/heartbeat$/, heartbeat.POST as Handler],
  ["POST", /^\/api\/obsidian\/bridge\/unpair$/, unpair.POST as Handler],
];

let offline = false;
let dropResults = false;
const fakeFetch: FetchLike = async (url, init) => {
  if (offline || (dropResults && url.includes("/result"))) throw new TypeError("fetch failed");
  const u = new URL(url);
  for (const [method, re, handler] of ROUTES) {
    const m = re.exec(u.pathname);
    if (m && method === (init?.method ?? "GET")) return handler(new Request(url, init), { params: Promise.resolve({ id: decodeURIComponent(m[1] ?? "") }) });
  }
  return new Response("not found", { status: 404 });
};

let env: CloudflareEnv;
let dir: string;
let sockDir: string;
const cleanup: (() => Promise<unknown>)[] = [];

beforeEach(async () => {
  env = freshEnv({ OBSIDIAN_PAYLOAD_KEY: KEY });
  await setProposalsEnabled(true);
  offline = false;
  dropResults = false;
  dir = await realpath(await mkdtemp(join(tmpdir(), "int-vault-")));
  await mkdir(join(dir, ".obsidian"));
  sockDir = await realpath(await mkdtemp(join(tmpdir(), "sk-")));
});
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
  await rm(dir, { recursive: true, force: true });
  await rm(sockDir, { recursive: true, force: true });
});

async function pairedService(over: Partial<BridgeConfig> = {}, backupOk = true) {
  const { code } = await createPairingCode();
  const { device_id, token } = await BridgeClient.pair(BASE, { code, name: "Test Mac", vault_name: "Test" }, fakeFetch);
  const credentials = new MemoryCredentialStore();
  await credentials.set(device_id, token);
  const cfg: BridgeConfig = { version: 1, lifeosUrl: BASE, vaultPath: dir, vaultName: "Test", deviceName: "Test Mac", deviceId: device_id, backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8, initialSyncConfirmedAt: new Date().toISOString(), ...over };
  const svc = new BridgeService({
    cfg,
    configFile: join(sockDir, "config.json"),
    stateFile: join(sockDir, "state.json"),
    socketPath: join(sockDir, "b.sock"),
    state: emptyState(),
    credentials,
    extractPdf: createPdfExtractor(HELPER),
    log: silentLogger,
    fetch: fakeFetch,
    safetyBackup: async () => ({ ok: backupOk, message: backupOk ? undefined : "disk full" }),
    debounceMs: 3_600_000, // the tests drive syncing by hand
    reconcileEveryMs: 3_600_000,
    wakeCheckMs: 3_600_000,
  });
  await svc.start();
  cleanup.push(() => svc.stop());
  // start() kicks off its own first poll; let it finish before the test drives things
  await new Promise((r) => setTimeout(r, 30));
  return { svc, device_id, token, client: new BridgeClient(BASE, token, fakeFetch) };
}
const write = async (rel: string, text: string) => {
  await mkdir(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
  await writeFile(join(dir, rel), text);
};

describe("pairing", () => {
  it("pairs with a one-time code, then every request needs the token", async () => {
    const { code } = await createPairingCode();
    const paired = await BridgeClient.pair(BASE, { code, name: "Mac" }, fakeFetch);
    await expect(BridgeClient.pair(BASE, { code, name: "Again" }, fakeFetch)).rejects.toMatchObject({ status: 400 });
    expect((await new BridgeClient(BASE, paired.token, fakeFetch).poll({ rev: "1970-01-01T00:00:00.000Z", exc: "1970-01-01T00:00:00.000Z" })).commands).toEqual([]);
    await expect(new BridgeClient(BASE, "wrong-token-wrong-token-12345", fakeFetch).poll({ rev: "x", exc: "x" })).rejects.toMatchObject({ status: 401 });
    await expect(new BridgeClient(BASE, null, fakeFetch).poll({ rev: "x", exc: "x" })).rejects.toMatchObject({ status: 401 });
  });
  it("revoking the device in LifeOS stops the Bridge; unpairing from the Mac revokes it too", async () => {
    const a = await pairedService();
    await revokeDevice(a.device_id);
    await a.svc.pollOnce();
    expect(a.svc.status().deviceRevoked).toBe(true);
    const { code } = await createPairingCode();
    const b = await BridgeClient.pair(BASE, { code, name: "Second" }, fakeFetch);
    await new BridgeClient(BASE, b.token, fakeFetch).unpair();
    expect((await listDevices()).every((d) => d.status === "revoked")).toBe(true);
    await expect(new BridgeClient(BASE, b.token, fakeFetch).poll({ rev: "x", exc: "x" })).rejects.toMatchObject({ code: "device_revoked" });
  });
});

describe("sync end to end", () => {
  it("syncs shared notes only, searchable in Thai and English, and nothing before confirmation", async () => {
    await write("Languages/Thai.md", NOTE(ID(1), true, "# ภาษาไทย\nการเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลัก\n"));
    await write("Programming/Java.md", NOTE(null, true, "# Java OOP\nPolymorphism and inheritance. See [[Personal Thoughts]]\n"));
    await write("Personal Thoughts.md", "my private diary entry");
    const gated = await pairedService({ initialSyncConfirmedAt: undefined });
    expect(await gated.svc.syncNow()).toBeNull();
    expect((await getObsidianStatus()).documents).toEqual([]);
    await cleanup.pop()!();

    const { svc } = await pairedService();
    const report = await svc.syncNow();
    expect(report).toMatchObject({ uploaded: 2, idsAssigned: 1 });
    expect((await searchKnowledge({ q: "โปรแกรม" })).results.map((r) => r.title)).toEqual(["Thai"]);
    expect((await searchKnowledge({ q: "polymorphism" })).results.map((r) => r.title)).toEqual(["Java"]);
    expect((await searchKnowledge({ q: "diary" })).results).toEqual([]);
    const read = await readDocument(ID(1));
    expect(read!.document).toMatchObject({ path: "Languages/Thai.md", status: "synced" });
    expect(read!.document.content_hash).toBe(sha256(NOTE(ID(1), true, "# ภาษาไทย\nการเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลัก\n")));
    // the Mac wrote a UUID into the note that had none, and nothing else
    expect(parseNote(await readFile(join(dir, "Programming/Java.md"), "utf8")).id).toMatch(/^[0-9a-f-]{36}$/);
    // a second pass sends nothing
    expect(await svc.syncNow()).toMatchObject({ uploaded: 0, unchanged: 2 });
  });
  it.skipIf(!existsSync(HELPER) || !existsSync(join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture")))("syncs PDF text with page numbers and cites the page", async () => {
    const { execFileSync } = await import("node:child_process");
    const tool = join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture");
    execFileSync(tool, [join(dir, "db.pdf"), "Helvetica", "Normalization removes redundancy", "Transactions are ACID"]);
    await write("Uni/DB.md", NOTE(ID(1), true, "Lecture: ![[db.pdf]]"));
    const { svc } = await pairedService();
    await svc.syncNow();
    const hit = (await searchKnowledge({ q: "ACID" })).results[0];
    expect(hit).toMatchObject({ kind: "pdf", page: 2, path: "db.pdf" });
    expect((await readDocument(hit.document_id, { page_from: 1, page_to: 1 }))!.chunks[0].content).toContain("Normalization");
  });
  it("a note whose text has a secret is held back, shows masked in LifeOS, and syncs after the owner approves that finding", async () => {
    await write("k.md", NOTE(ID(1), true, 'My login\npassword = "hunter2hunter2"\n'));
    await write("ok.md", NOTE(ID(2), true, "fine"));
    const { svc } = await pairedService();
    expect(await svc.syncNow()).toMatchObject({ uploaded: 1, blocked: { secret: 1 } });
    const [f] = await listFindings();
    expect(f).toMatchObject({ document_id: ID(1), kind: "password_assignment", status: "open" });
    expect(JSON.stringify(f)).not.toContain("hunter2");
    expect((await searchKnowledge({ q: "hunter2" })).results).toEqual([]);
    await exceptFinding(f.id);
    await svc.pollOnce(); // the approval reaches the Mac
    await svc.syncNow();
    expect((await searchKnowledge({ q: "My login" })).results.map((r) => r.document_id)).toEqual([ID(1)]);
  });
});

describe("revoke while the Mac is offline", () => {
  it("LifeOS drops the note at once; the Mac applies it on reconnect and never re-uploads", async () => {
    await write("a.md", NOTE(ID(1), true, "secret knowledge about zebras"));
    const { svc } = await pairedService();
    await svc.syncNow();
    expect((await searchKnowledge({ q: "zebras" })).results).toHaveLength(1);

    offline = true;
    await revokeDocument(ID(1)); // from the phone, Mac is off
    expect((await searchKnowledge({ q: "zebras" })).results).toEqual([]);
    expect(await readDocument(ID(1))).toBeNull();
    await svc.pollOnce(); // still offline
    expect(svc.status().backoffSeconds).toBeGreaterThan(0);
    expect(parseNote(await readFile(join(dir, "a.md"), "utf8")).sync).toBe(true);

    offline = false;
    await svc.pollOnce();
    expect(parseNote(await readFile(join(dir, "a.md"), "utf8")).sync).toBe(false);
    await svc.syncNow();
    expect((await searchKnowledge({ q: "zebras" })).results).toEqual([]);

    // even if the flag is put back by an old copy, the note stays out
    await write("a.md", NOTE(ID(1), true, "secret knowledge about zebras"));
    await svc.syncNow();
    expect((await searchKnowledge({ q: "zebras" })).results).toEqual([]);
  });
  it("re-enabling in LifeOS brings it back with a fresh scan under a new grant", async () => {
    await write("a.md", NOTE(ID(1), true, "knowledge about zebras"));
    const { svc } = await pairedService();
    await svc.syncNow();
    await revokeDocument(ID(1));
    await svc.pollOnce();
    await reenableDocument(ID(1));
    await svc.pollOnce();
    expect(parseNote(await readFile(join(dir, "a.md"), "utf8")).sync).toBe(true);
    await svc.syncNow();
    expect((await searchKnowledge({ q: "zebras" })).results).toHaveLength(1);
  });
  it("re-enabling from the Mac works the same way", async () => {
    await write("a.md", NOTE(ID(1), true, "knowledge about zebras"));
    const { svc, client } = await pairedService();
    await svc.syncNow();
    await revokeDocument(ID(1));
    await svc.pollOnce();
    const res = await client.reenable(ID(1));
    expect(res.grant_version).toBe(2);
  });
});

describe("approved changes", () => {
  async function approve(op: Parameters<typeof queueVaultProposal>[0]) {
    const q = await queueVaultProposal(op);
    await approvePending(q.pending_id, "+07:00");
    return q;
  }
  it("creates a note Claude proposed, then it is synced and searchable", async () => {
    const { svc } = await pairedService();
    const q = await approve({ op: "create_note", payload: { path: "Programming/Web/REST API.md", content: "# REST API\nResources, verbs and status codes.\n" }, summary: "Create note Programming/Web/REST API.md" });
    await svc.pollOnce();
    const text = await readFile(join(dir, "Programming/Web/REST API.md"), "utf8");
    expect(parseNote(text)).toMatchObject({ sync: true });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "approved" });
    expect((await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first())).toEqual({ status: "applied", payload_enc: null });
    await svc.syncNow();
    expect((await searchKnowledge({ q: "status codes" })).results[0]).toMatchObject({ title: "REST API", path: "Programming/Web/REST API.md" });
  });
  it("nothing runs until approved, and a rejected proposal never reaches the Mac", async () => {
    const { svc } = await pairedService();
    await queueVaultProposal({ op: "create_note", payload: { path: "n.md", content: "x" }, summary: "Create note n.md" });
    await svc.pollOnce();
    await expect(readFile(join(dir, "n.md"), "utf8")).rejects.toThrow();
  });
  it("an edit approved while the Mac was away stops with a conflict when the owner changed the note meanwhile", async () => {
    const original = NOTE(ID(1), true, "line one\nline two\n");
    await write("n.md", original);
    const { svc } = await pairedService();
    await svc.syncNow();
    const q = await approve({ op: "edit_note", payload: { path: "n.md", new_content: "line one\nline two\nPolymorphism added\n", expected_hash: sha256(original) }, summary: "Edit note n.md" });
    const mine = NOTE(ID(1), true, "line one\nline two edited by me\n");
    await writeFile(join(dir, "n.md"), mine); // the owner edits while the Mac was offline
    await svc.pollOnce();
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe(mine);
    const cmd = await env.DB.prepare("SELECT status FROM obsidian_commands WHERE id = ?").bind(q.command_id).first();
    expect(cmd).toEqual({ status: "conflict" });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "failed" });
  });
  it("applies an edit to an unchanged note after a safety backup, and a failed backup changes nothing", async () => {
    const original = NOTE(ID(1), true, "old body\n");
    await write("n.md", original);
    const ok = await pairedService();
    await approve({ op: "edit_note", payload: { path: "n.md", new_content: "new body\n", expected_hash: sha256(original) }, summary: "Edit note n.md" });
    await ok.svc.pollOnce();
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe(NOTE(ID(1), true, "new body\n"));
    await cleanup.pop()!();

    const current = await readFile(join(dir, "n.md"), "utf8");
    const bad = await pairedService({}, false);
    const q = await approve({ op: "delete_note", payload: { path: "n.md" }, summary: "Delete note n.md" });
    await bad.svc.pollOnce();
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe(current);
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "failed" });
  });
  it("a command is not run twice even if reporting its result failed", async () => {
    const { svc } = await pairedService();
    const q = await approve({ op: "create_note", payload: { path: "once.md", content: "first" }, summary: "Create note once.md" });
    dropResults = true; // the network drops right after the file was written
    await svc.pollOnce();
    expect(await readFile(join(dir, "once.md"), "utf8")).toContain("first");
    expect(await env.DB.prepare("SELECT status FROM obsidian_commands WHERE id = ?").bind(q.command_id).first()).toEqual({ status: "claimed" });
    // the claim goes stale, so LifeOS offers it again: the Mac must not run it a second time
    await env.DB.prepare("UPDATE obsidian_commands SET claimed_at = ? WHERE id = ?").bind(new Date(Date.now() - 11 * 60_000).toISOString(), q.command_id).run();
    await svc.pollOnce();
    expect(await env.DB.prepare("SELECT attempts FROM obsidian_commands WHERE id = ?").bind(q.command_id).first()).toEqual({ attempts: 1 }); // not claimed again
    expect(await readFile(join(dir, "once.md"), "utf8")).toContain("first");
    dropResults = false;
    await svc.pollOnce(); // the saved result is delivered
    expect(await env.DB.prepare("SELECT status FROM obsidian_commands WHERE id = ?").bind(q.command_id).first()).toEqual({ status: "applied" });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "approved" });
  });
});

describe("Claude over MCP, start to finish", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await handleMcpPost(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return { isError: !!body.result.isError, ...(JSON.parse(body.result.content[0].text.startsWith("{") ? body.result.content[0].text : "{}") as object), text: body.result.content[0].text };
  }
  const approveLatest = async () => {
    const row = await env.DB.prepare("SELECT id FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
    await approvePending(row!.id, "+07:00");
  };

  it("edit: read, propose with the hash, approve, the Mac edits, syncs, and Claude reads the new text", async () => {
    await write("Programming/Java OOP.md", NOTE(ID(1), true, "# Java OOP\nInheritance only.\n"));
    const { svc } = await pairedService();
    await svc.syncNow();
    const found = await mcp("search_obsidian_knowledge", { query: "Inheritance" });
    const read = await mcp("read_obsidian_note", { id: found.results[0].document_id });
    expect(read.content).toContain("Inheritance only");
    const prop = await mcp("propose_edit_note", { path: read.source_path, new_content: "# Java OOP\nInheritance and Polymorphism.\n", expected_hash: read.content_hash });
    expect(prop.queued).toBe(true);
    expect(await readFile(join(dir, "Programming/Java OOP.md"), "utf8")).toContain("Inheritance only."); // nothing yet
    await approveLatest();
    await svc.pollOnce();
    expect(await readFile(join(dir, "Programming/Java OOP.md"), "utf8")).toBe(NOTE(ID(1), true, "# Java OOP\nInheritance and Polymorphism.\n"));
    await svc.syncNow();
    const after = await mcp("read_obsidian_note", { id: ID(1) });
    expect(after.content).toContain("Polymorphism");
    expect(after.content_hash).not.toBe(read.content_hash);
    // the old hash is no longer accepted
    expect((await mcp("propose_edit_note", { path: read.source_path, new_content: "x", expected_hash: read.content_hash })).isError).toBe(true);
  });
  it("organize: a folder move with local-only files inside moves everything, and the cloud paths follow", async () => {
    await write("Inbox/Java/a.md", NOTE(ID(1), true, "alpha polymorphism"));
    await write("Inbox/Java/private.md", "local only, never shared");
    const { svc } = await pairedService();
    await svc.syncNow();
    const prop = await mcp("propose_move_folder", { path: "Inbox/Java", new_path: "Programming/Java" });
    expect(prop.summary).toMatch(/1 synced note;/);
    await approveLatest();
    await svc.pollOnce();
    expect(await readFile(join(dir, "Programming/Java/private.md"), "utf8")).toBe("local only, never shared");
    await svc.syncNow();
    expect((await mcp("search_obsidian_knowledge", { query: "polymorphism" })).results[0].source_path).toBe("Programming/Java/a.md");
  });
  it("delete folder: the synced copy disappears from Claude's view and the files sit in the trash", async () => {
    await write("Old/a.md", NOTE(ID(1), true, "obsolete zebra knowledge"));
    await write("Old/private.md", "mine");
    const { svc } = await pairedService();
    await svc.syncNow();
    expect((await mcp("propose_delete_folder", { path: "Old" })).queued).toBe(true);
    await approveLatest();
    await svc.pollOnce();
    await expect(readFile(join(dir, "Old/a.md"), "utf8")).rejects.toThrow();
    expect(await readFile(join(dir, ".trash/Old/private.md"), "utf8")).toBe("mine");
    await svc.syncNow();
    expect((await mcp("search_obsidian_knowledge", { query: "zebra" })).results).toEqual([]);
  });
});

describe("review fixes, end to end", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await handleMcpPost(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return { isError: !!body.result.isError, ...(JSON.parse(body.result.content[0].text.startsWith("{") ? body.result.content[0].text : "{}") as object), text: body.result.content[0].text };
  }

  it("deleting a big shared folder (more than the brake allows) removes every synced copy", async () => {
    for (let i = 1; i <= 14; i++) await write(`Old/n${i}.md`, NOTE(ID(i), true, `obsolete zebra ${i}`));
    await write("Keep/k.md", NOTE(ID(99), true, "keep me"));
    const { svc } = await pairedService();
    await svc.syncNow();
    expect((await mcp("search_obsidian_knowledge", { query: "zebra" })).total).toBe(14);
    expect((await mcp("propose_delete_folder", { path: "Old" })).summary).toMatch(/14 synced notes/);
    const row = await env.DB.prepare("SELECT id FROM pending_actions WHERE status = 'pending'").first<{ id: string }>();
    await approvePending(row!.id, "+07:00");
    await svc.pollOnce();
    await svc.syncNow();
    expect((await mcp("search_obsidian_knowledge", { query: "zebra" })).results).toEqual([]);
    expect((await mcp("search_obsidian_knowledge", { query: "keep me" })).results).toHaveLength(1);
    expect(svc.status().lastError ?? null).toBeNull();
  });
  it("the folder impact counts every shared note, not just the first 200", async () => {
    const { upload } = await import("@/modules/obsidian/documents");
    for (let i = 1; i <= 250; i++) await upload("d", { id: ID(i), kind: "note", title: `N${i}`, path: `Big/N${i}.md`, content_hash: `h${i}-xxxx`, tags: [], grant_version: 0, sync_version: 1, total_chunks: 1, chunks: [{ index: 0, content: `text ${i}` }] });
    const r = await mcp("propose_delete_folder", { path: "Big" });
    expect(r.summary).toMatch(/250 synced notes/);
  });
  it.skipIf(!existsSync(HELPER) || !existsSync(join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture")))("a PDF the owner re-enabled is uploaded again", async () => {
    const { execFileSync } = await import("node:child_process");
    execFileSync(join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture"), [join(dir, "db.pdf"), "Helvetica", "Normalization removes redundancy"]);
    await write("DB.md", NOTE(ID(1), true, "Lecture ![[db.pdf]]"));
    const { svc } = await pairedService();
    await svc.syncNow();
    const hit = (await searchKnowledge({ q: "Normalization" })).results[0];
    await revokeDocument(hit.document_id);
    await svc.pollOnce();
    expect((await searchKnowledge({ q: "Normalization" })).results).toEqual([]);
    await reenableDocument(hit.document_id);
    await svc.pollOnce();
    await svc.syncNow();
    expect((await searchKnowledge({ q: "Normalization" })).results[0]).toMatchObject({ kind: "pdf", page: 1 });
  });
});

describe("re-enable while the Mac never saw the revoke", () => {
  it.skipIf(!existsSync(HELPER) || !existsSync(join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture")))("a PDF revoked and re-enabled while the Mac was away is uploaded again", async () => {
    const { execFileSync } = await import("node:child_process");
    execFileSync(join(process.cwd(), "tools/obsidian-bridge/core/native/bin/make-fixture"), [join(dir, "db.pdf"), "Helvetica", "Normalization removes redundancy"]);
    await write("DB.md", NOTE(ID(1), true, "Lecture ![[db.pdf]]"));
    const { svc } = await pairedService();
    await svc.syncNow();
    const hit = (await searchKnowledge({ q: "Normalization" })).results[0];
    offline = true;
    await revokeDocument(hit.document_id);
    await reenableDocument(hit.document_id); // the Mac only ever sees the final "re-enabled" state
    offline = false;
    await svc.pollOnce();
    await svc.syncNow();
    expect((await searchKnowledge({ q: "Normalization" })).results[0]).toMatchObject({ kind: "pdf", page: 1 });
  });
});

describe("network trouble", () => {
  it("polls every 15 seconds when healthy, backs off (bounded) when offline, and recovers", async () => {
    const { svc } = await pairedService();
    expect(svc.nextDelayMs()).toBe(15_000);
    offline = true;
    for (let i = 0; i < 12; i++) await svc.pollOnce();
    const s = svc.status();
    expect(s.online).toBe(false);
    expect(s.backoffSeconds).toBeGreaterThan(15);
    expect(s.backoffSeconds).toBeLessThanOrEqual(330);
    offline = false;
    await svc.pollOnce();
    expect(svc.status()).toMatchObject({ online: true, backoffSeconds: 0 });
    expect(svc.nextDelayMs()).toBe(15_000);
  });
  it("an empty poll writes nothing to the database and counts as one request", async () => {
    const { svc } = await pairedService();
    const count = async () => (await env.DB.prepare("SELECT (SELECT COUNT(*) FROM obsidian_sync_state) + (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM obsidian_commands) AS n").first<{ n: number }>())!.n;
    const before = await count();
    const used = svc.status().usageToday.polls;
    await svc.pollOnce();
    await svc.pollOnce();
    expect(await count()).toBe(before);
    expect(svc.status().usageToday.polls).toBe(used + 2);
  });
  it("while paused in LifeOS it still applies revocations but does not sync or run commands", async () => {
    await write("a.md", NOTE(ID(1), true, "zebras"));
    const { svc, device_id } = await pairedService();
    await svc.syncNow();
    await env.DB.prepare("UPDATE obsidian_devices SET paused = 1 WHERE id = ?").bind(device_id).run();
    await svc.pollOnce();
    expect(svc.status().paused).toBe(true);
    expect(await svc.syncNow()).toBeNull();
    const q = await queueVaultProposal({ op: "create_note", payload: { path: "p.md", content: "x" }, summary: "Create note p.md" });
    await approvePending(q.pending_id, "+07:00");
    await revokeDocument(ID(1));
    await svc.pollOnce();
    await expect(readFile(join(dir, "p.md"), "utf8")).rejects.toThrow();
    expect(parseNote(await readFile(join(dir, "a.md"), "utf8")).sync).toBe(false);
  });
});

// The Worker and the Bridge must apply exactly the same secret rules, path rules and chunk sizes.
describe("shared code stays identical", () => {
  for (const f of ["secrets.ts", "paths.ts", "chunk.ts", "crypto.ts", "diff.ts"]) {
    it(`${f}: the Bridge copy matches src/lib/obsidian (run npm run sync-shared in tools/obsidian-bridge/core)`, () => {
      expect(readFileSync(join(process.cwd(), "tools/obsidian-bridge/core/src/shared", f), "utf8")).toBe(readFileSync(join(process.cwd(), "src/lib/obsidian", f), "utf8"));
    });
  }
});
