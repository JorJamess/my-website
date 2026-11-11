import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanForSecrets, withoutExceptions } from "@/lib/obsidian/secrets";
import { decryptPayload, encryptPayload, normalizeCode, randomPairingCode } from "@/lib/obsidian/crypto";
import { chunkText } from "@/lib/obsidian/chunk";
import { PathError, validateVaultPath } from "@/lib/obsidian/paths";
import { authenticateDevice, completePairing, createPairingCode, listDevices, revokeDevice } from "@/modules/obsidian/devices";
import { exceptFinding, listFindings, readDocument, reconcileAfterRestore, reenableDocument, removeDocument, revokeDocument, searchKnowledge, SyncRejected, updatePath, upload, type UploadInput, getObsidianStatus, revocationsSince, exceptionsSince } from "@/modules/obsidian/documents";
import { approvePending, rejectPending, riskOf } from "@/lib/server/mcp/gate";
import { claimCommand, expireCommands, listCommands, pollCommands, previewCommand, queueVaultProposal, reportResult } from "@/modules/obsidian/commands";
import { deviceApi } from "@/lib/server/device-api";
import { BACKUP_TABLES, buildSnapshot, parseSnapshot, restoreSnapshot } from "@/lib/backup-core";
import * as repo from "@/lib/server/repo";
import { freshEnv } from "./helpers/env";

const KEY = btoa("0123456789abcdef0123456789abcdef");
let env: CloudflareEnv;
beforeEach(() => {
  env = freshEnv({ OBSIDIAN_PAYLOAD_KEY: KEY });
});
afterEach(() => vi.useRealTimers());

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (n: number, over: Partial<UploadInput> = {}): UploadInput => ({
  id: ID(n),
  kind: "note",
  title: `Note ${n}`,
  path: `Programming/Note ${n}.md`,
  content_hash: `hash-${n}-1`,
  tags: ["java"],
  grant_version: 0,
  sync_version: 1,
  total_chunks: 1,
  chunks: [{ index: 0, content: "Java OOP explains polymorphism and inheritance." }],
  ...over,
});

describe("secret scanner", () => {
  it("finds common credentials and masks them", () => {
    const text = [
      "key: sk-ant-api03-abcdefghijklmnopqrstuvwx",
      "aws AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN RSA PRIVATE KEY-----",
      'password = "hunter2hunter2"',
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    ].join("\n");
    const f = scanForSecrets(text);
    expect(f.map((x) => x.kind)).toEqual(expect.arrayContaining(["anthropic_key", "aws_access_key", "private_key", "password_assignment", "github_token"]));
    for (const x of f) expect(JSON.stringify(x)).not.toMatch(/abcdefghijklmnop|hunter2hunter2|IOSFODNN/);
    expect(f.every((x) => x.redacted.length <= 8)).toBe(true);
  });
  it("ignores ordinary notes and placeholders", () => {
    expect(scanForSecrets("Java OOP uses classes.\nSet password = <your password> and API_KEY=${API_KEY}.\nHashMap<String, Integer> map = new HashMap<>();")).toEqual([]);
    expect(scanForSecrets("password: example")).toEqual([]);
  });
  it("exceptions are per finding and tied to the exact content", () => {
    const [a, b] = scanForSecrets('password = "aaaaaaaa1"\napi_key = "bbbbbbbb2"');
    expect(withoutExceptions([a, b], [{ fingerprint: a.fingerprint, contentHash: "h1" }], "h1")).toEqual([b]);
    expect(withoutExceptions([a, b], [{ fingerprint: a.fingerprint, contentHash: "h1" }], "h2")).toEqual([a, b]);
  });
});

describe("crypto, chunks, paths", () => {
  it("encrypts with a fresh nonce and binds to the row", async () => {
    const a = await encryptPayload(KEY, "row1", "hello");
    const b = await encryptPayload(KEY, "row1", "hello");
    expect(a).not.toBe(b);
    expect(await decryptPayload(KEY, "row1", a)).toBe("hello");
    await expect(decryptPayload(KEY, "row2", a)).rejects.toThrow();
    await expect(encryptPayload(btoa("short"), "r", "x")).rejects.toThrow();
  });
  it("pairing codes have no look-alike characters", () => {
    expect(randomPairingCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(normalizeCode("k7qm-4xd2")).toBe("K7QM4XD2");
  });
  it("chunks stay bounded", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"x".repeat(900)}`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
    expect(chunkText("y".repeat(10_000)).every((c) => c.length <= 4000)).toBe(true);
  });
  it("accepts vault paths and rejects escapes", () => {
    expect(validateVaultPath("Programming/Java/OOP.md", { kind: "note" })).toBe("Programming/Java/OOP.md");
    expect(validateVaultPath("Programming/Java/", { kind: "folder" })).toBe("Programming/Java");
    for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd.md", "~/x.md", ".obsidian/app.json", "a/.obsidian/x.md", "C:/x.md", "a//b.md", "a/b.txt", "a\\b.md", "a/ b.md", ".trash/x.md", ""]) {
      expect(() => validateVaultPath(bad, { kind: "note" }), bad).toThrow(PathError);
    }
  });
});

describe("pairing and device tokens", () => {
  it("a code works once, the token is only stored hashed", async () => {
    const { code } = await createPairingCode();
    const { token, device_id } = await completePairing({ code, name: "James's Mac", vault_name: "James Knowledge" });
    await expect(completePairing({ code, name: "Again" })).rejects.toThrow(/wrong, already used, or expired/);
    const row = await env.DB.prepare("SELECT * FROM obsidian_devices WHERE id = ?").bind(device_id).first<{ token_hash: string }>();
    expect(row!.token_hash).not.toContain(token);
    expect(JSON.stringify(await listDevices())).not.toContain("token");
    expect((await authenticateDevice(token))?.id).toBe(device_id);
    expect(await authenticateDevice(token + "x")).toBeNull();
    expect(await authenticateDevice(null)).toBeNull();
  });
  it("codes expire and wrong codes fail", async () => {
    vi.useFakeTimers();
    const { code } = await createPairingCode();
    await expect(completePairing({ code: "AAAA-BBBB", name: "x" })).rejects.toThrow();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(completePairing({ code, name: "x" })).rejects.toThrow(/expired/);
  });
  it("revoking a device stops its token at once", async () => {
    const { code } = await createPairingCode();
    const { token, device_id } = await completePairing({ code, name: "Mac" });
    expect(await revokeDevice(device_id)).toBe(true);
    expect(await authenticateDevice(token)).toBeNull();
  });
  it("does not write last_seen on every request", async () => {
    const { code } = await createPairingCode();
    const { token, device_id } = await completePairing({ code, name: "Mac" });
    const seen = () => env.DB.prepare("SELECT last_seen_at FROM obsidian_devices WHERE id = ?").bind(device_id).first<{ last_seen_at: string }>().then((r) => r!.last_seen_at);
    const first = await seen();
    for (let i = 0; i < 5; i++) await authenticateDevice(token);
    expect(await seen()).toBe(first);
  });
  it("deviceApi rejects missing and wrong tokens, then locks the IP out", async () => {
    const h = deviceApi(async () => Response.json({ ok: true }));
    const call = (token?: string) => h(new Request("http://x/api/obsidian/bridge/poll", { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "cf-connecting-ip": "9.9.9.9" } }), undefined as never);
    expect((await call()).status).toBe(401);
    for (let i = 0; i < 4; i++) await call("wrong-token-wrong-token-1");
    expect((await call("wrong-token-wrong-token-1")).status).toBe(429);
    const { code } = await createPairingCode();
    const { token } = await completePairing({ code, name: "Mac" });
    expect((await h(new Request("http://x/", { headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": "8.8.8.8" } }), undefined as never)).status).toBe(200);
  });
});

describe("uploading and searching shared notes", () => {
  it("makes a note searchable, in English, Thai, Japanese and code", async () => {
    await upload("dev", doc(1));
    await upload("dev", doc(2, { title: "ภาษาไทย", path: "Languages/Thai.md", chunks: [{ index: 0, content: "การเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลักของภาษาจาวา" }] }));
    await upload("dev", doc(3, { title: "日本語", path: "Languages/Japanese.md", chunks: [{ index: 0, content: "データベース設計の基本を学ぶ" }] }));
    await upload("dev", doc(4, { path: "Programming/React.md", chunks: [{ index: 0, content: "Call useEffect after render. A HashMap stores pairs. SQL JOIN combines tables." }] }));
    const titles = async (q: string) => (await searchKnowledge({ q })).results.map((r) => r.title);
    expect(await titles("polymorphism")).toEqual(["Note 1"]);
    expect(await titles("โปรแกรม")).toEqual(["ภาษาไทย"]);
    expect(await titles("ベース")).toEqual(["日本語"]);
    expect(await titles("useEffect")).toEqual(["Note 4"]);
    expect(await titles("hashmap")).toEqual(["Note 4"]);
    expect(await titles("SQL JOIN")).toEqual(["Note 4"]);
    expect(await titles("OOP")).toEqual(["Note 1"]);
    // shorter than 3 characters: bounded LIKE fallback
    expect(await titles("Ef")).toEqual(["Note 4"]);
    expect(await titles("ข้อ")).toEqual([]);
    expect(await titles("nothing like this")).toEqual([]);
  });
  it("handles quotes and punctuation in queries", async () => {
    await upload("dev", doc(1, { chunks: [{ index: 0, content: 'He said "hello" (world) & C++ rocks' }] }));
    expect((await searchKnowledge({ q: '"hello"' })).results).toHaveLength(1);
    expect((await searchKnowledge({ q: "C++" })).results).toHaveLength(1);
    expect((await searchKnowledge({ q: "world) &" })).results).toHaveLength(1);
  });
  it("returns excerpts, filters by tag and kind, and pages", async () => {
    await upload("dev", doc(1, { chunks: [{ index: 0, content: "x".repeat(3000) + " polymorphism " + "y".repeat(3000) }] }));
    await upload("dev", doc(2, { tags: ["web"], chunks: [{ index: 0, content: "polymorphism in web" }] }));
    const r = await searchKnowledge({ q: "polymorphism" });
    expect(r.results).toHaveLength(2);
    expect(r.results[0].excerpt.length).toBeLessThan(500);
    expect((await searchKnowledge({ q: "polymorphism", tag: "web" })).results.map((x) => x.title)).toEqual(["Note 2"]);
    expect((await searchKnowledge({ q: "polymorphism", kind: "pdf" })).results).toEqual([]);
    expect((await searchKnowledge({ q: "polymorphism", limit: 1, offset: 1 })).results).toHaveLength(1);
  });
  it("a new version replaces the old text", async () => {
    await upload("dev", doc(1));
    await upload("dev", doc(1, { sync_version: 2, chunks: [{ index: 0, content: "Completely different text about sorting" }] }));
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
    expect((await searchKnowledge({ q: "sorting" })).results).toHaveLength(1);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_chunks").first<{ n: number }>();
    expect(n!.n).toBe(1);
    const f = await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_fts").first<{ n: number }>().catch(() => null);
    if (f) expect(f.n).toBe(1);
  });
  it("refuses an older version", async () => {
    await upload("dev", doc(1, { sync_version: 3 }));
    await expect(upload("dev", doc(1, { sync_version: 2 }))).rejects.toMatchObject({ code: "stale_version" });
    await expect(upload("dev", doc(1, { sync_version: 3 }))).rejects.toMatchObject({ code: "stale_version" });
  });
  it("assembles a multi-part upload and hides it until complete", async () => {
    const chunks = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ index: from + i, content: `part chunk ${from + i} zebra` }));
    const first = await upload("dev", { ...doc(1, { total_chunks: 4, chunks: chunks(0, 2) }), part: 0 });
    expect(first.status).toBe("syncing");
    expect((await searchKnowledge({ q: "zebra" })).results).toEqual([]);
    const second = await upload("dev", { ...doc(1, { total_chunks: 4, chunks: chunks(2, 2) }), part: 1 });
    expect(second.status).toBe("synced");
    const read = await readDocument(ID(1));
    expect(read!.chunks.map((c) => c.chunk_index)).toEqual([0, 1, 2, 3]);
  });
  it("only stores bounded requests and valid paths", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ index: i, content: "a" }));
    await expect(upload("dev", doc(1, { total_chunks: 51, chunks: many }))).rejects.toMatchObject({ code: "bad_request" });
    await expect(upload("dev", doc(1, { path: "../evil.md" }))).rejects.toMatchObject({ code: "bad_request" });
    await expect(upload("dev", doc(1, { path: ".obsidian/x.md" }))).rejects.toMatchObject({ code: "bad_request" });
  });
  it("stores nothing when the text has a secret, and reports it masked", async () => {
    await expect(upload("dev", doc(1, { chunks: [{ index: 0, content: "my key sk-ant-api03-abcdefghijklmnopqrstuvwx" }] }))).rejects.toMatchObject({ code: "blocked_secret" });
    const d = await env.DB.prepare("SELECT status FROM obsidian_documents WHERE id = ?").bind(ID(1)).first<{ status: string }>();
    expect(d!.status).toBe("blocked_secret");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_chunks").first<{ n: number }>())!.n).toBe(0);
    const findings = await listFindings();
    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnop");
    expect((await searchKnowledge({ q: "abcdefghijklmnop" })).results).toEqual([]);
  });
  it("a finding exception is passed to the Bridge and bound to the content hash", async () => {
    await upload("dev", doc(1, { chunks: [{ index: 0, content: 'password = "hunter2hunter2"' }], content_hash: "h-a" })).catch(() => {});
    const [f] = await listFindings();
    expect(await exceptFinding(f.id)).toBe(true);
    expect(await exceptFinding(f.id)).toBe(false);
    const ex = await exceptionsSince("1970-01-01T00:00:00.000Z");
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ document_id: ID(1), content_hash: "h-a" });
    expect(JSON.stringify(ex)).not.toContain("hunter2");
  });
  it("tracks PDF text and removes it when no shared note references it", async () => {
    const pdf = "pdf:" + "a".repeat(32);
    await upload("dev", { ...doc(10, { id: pdf, kind: "pdf", title: "Database lecture", path: "University/db.pdf" }), kind: "pdf", pdf: { state: "completed", pages: 2, size_bytes: 1000 }, chunks: [{ index: 0, page: 1, content: "Normalization removes redundancy" }, { index: 1, page: 2, content: "Transactions are ACID" }], total_chunks: 2 });
    await upload("dev", doc(1, { pdf_refs: [pdf] }));
    await upload("dev", doc(2, { pdf_refs: [pdf] }));
    expect((await searchKnowledge({ q: "normalization" })).results[0]).toMatchObject({ kind: "pdf", page: 1 });
    const page2 = await readDocument(pdf, { page_from: 2, page_to: 2 });
    expect(page2!.chunks).toHaveLength(1);
    await removeDocument(ID(1));
    expect((await searchKnowledge({ q: "normalization" })).results).toHaveLength(1); // still referenced by note 2
    await revokeDocument(ID(2));
    expect((await searchKnowledge({ q: "normalization" })).results).toEqual([]);
    expect(await readDocument(pdf)).toBeNull();
  });
  it("marks image-only PDFs as no_text and too-large as failed without storing text", async () => {
    const pdf = "pdf:" + "b".repeat(32);
    const r = await upload("dev", { ...doc(11, { id: pdf, kind: "pdf", title: "Scan", path: "Scan.pdf", total_chunks: 0, chunks: [] }), pdf: { state: "no_text", pages: 3 } });
    expect(r.status).toBe("no_text");
    expect((await searchKnowledge({ q: "anything" })).results).toEqual([]);
  });
  it("updates the path after a rename or move without touching the text", async () => {
    await upload("dev", doc(1));
    expect(await updatePath(ID(1), "Programming/Java/OOP.md", "OOP")).toBe(true);
    const r = await searchKnowledge({ q: "polymorphism" });
    expect(r.results[0]).toMatchObject({ path: "Programming/Java/OOP.md", title: "OOP" });
    await expect(updatePath(ID(1), "../x.md")).rejects.toThrow();
  });
  it("bounds what read_document returns", async () => {
    await upload("dev", doc(1, { total_chunks: 10, chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, content: "w".repeat(3900) })) }));
    const r = await readDocument(ID(1), { max_chars: 10_000 });
    expect(r!.truncated).toBe(true);
    expect(r!.chunks.length).toBeLessThanOrEqual(3);
    expect(r!.next_chunk).toBe(r!.chunks.length);
    expect(r!.total_chunks).toBe(10);
  });
});

describe("emergency revoke", () => {
  it("removes text, search entries and PDF text at once and keeps a tombstone", async () => {
    await upload("dev", doc(1));
    expect((await searchKnowledge({ q: "polymorphism" })).results).toHaveLength(1);
    const { grant_version } = await revokeDocument(ID(1));
    expect(grant_version).toBe(1);
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
    expect(await readDocument(ID(1))).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_chunks").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_fts").first<{ n: number }>())!.n).toBe(0);
    expect(await revocationsSince("1970-01-01T00:00:00.000Z")).toMatchObject([{ document_id: ID(1), state: "revoked" }]);
    // audit has no content
    const log = (await repo.listAudit()).map((a) => a.summary).join("\n");
    expect(log).toContain("Revoked");
    expect(log).not.toContain("polymorphism");
  });
  it("a stale upload cannot bring a revoked note back, even with the old flag", async () => {
    await upload("dev", doc(1));
    await revokeDocument(ID(1));
    await expect(upload("dev", doc(1, { sync_version: 5 }))).rejects.toMatchObject({ code: "revoked" });
    await expect(upload("dev", doc(1, { sync_version: 6, grant_version: 1 }))).rejects.toMatchObject({ code: "revoked" });
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
  });
  it("works for a note that was never uploaded", async () => {
    await revokeDocument(ID(7));
    await expect(upload("dev", doc(7))).rejects.toMatchObject({ code: "revoked" });
  });
  it("re-enabling needs the new grant version", async () => {
    await upload("dev", doc(1));
    await revokeDocument(ID(1));
    const { grant_version } = await reenableDocument(ID(1));
    expect(grant_version).toBe(2);
    await expect(upload("dev", doc(1, { sync_version: 2, grant_version: 0 }))).rejects.toMatchObject({ code: "stale_grant" });
    await expect(upload("dev", doc(1, { sync_version: 2, grant_version: 1 }))).rejects.toMatchObject({ code: "stale_grant" });
    await upload("dev", doc(1, { sync_version: 2, grant_version }));
    expect((await searchKnowledge({ q: "polymorphism" })).results).toHaveLength(1);
    await expect(reenableDocument(ID(1))).rejects.toThrow(/not revoked/);
  });
  it("a revoke of a revoked-then-reenabled note bumps the version again", async () => {
    await upload("dev", doc(1));
    await revokeDocument(ID(1));
    await reenableDocument(ID(1));
    expect((await revokeDocument(ID(1))).grant_version).toBe(3);
  });
});

describe("backup scope and restore", () => {
  it("backs up tombstones but never note text, chunks or payloads", async () => {
    await upload("dev", doc(1));
    await revokeDocument(ID(5));
    await queueVaultProposal({ op: "create_note", payload: { path: "A/b.md", content: "SECRET-BODY" }, summary: "Create note A/b.md" });
    const snap = await buildSnapshot(env.DB, "manual");
    expect(BACKUP_TABLES).toContain("obsidian_revocations");
    expect(snap.tables.obsidian_revocations).toHaveLength(1);
    const text = JSON.stringify(snap);
    expect(text).not.toContain("polymorphism");
    expect(text).not.toContain("SECRET-BODY");
    expect(text).not.toContain("payload_enc");
    expect(Object.keys(snap.tables).filter((t) => t.startsWith("obsidian_"))).toEqual(["obsidian_revocations"]);
  });
  it("restoring an older backup never un-revokes a note", async () => {
    await upload("dev", doc(1));
    const before = await buildSnapshot(env.DB, "manual"); // no tombstone yet
    await revokeDocument(ID(1));
    await revokeDocument(ID(2));
    const old = parseSnapshot(JSON.parse(JSON.stringify(before)));
    await restoreSnapshot(env.DB, old);
    const rows = (await env.DB.prepare("SELECT document_id, state FROM obsidian_revocations ORDER BY document_id").all()).results;
    expect(rows).toEqual([{ document_id: ID(1), state: "revoked" }, { document_id: ID(2), state: "revoked" }]);
  });
  it("a snapshot with a higher grant version wins; a lower one does not", async () => {
    await revokeDocument(ID(1));
    await reenableDocument(ID(1)); // v2, reenabled
    const snap = parseSnapshot({ app: "jameswebpupu", version: 1, created_at: "x", reason: "manual", tables: { obsidian_revocations: [{ document_id: ID(1), grant_version: 1, state: "revoked", reason: "owner", revoked_at: "t", reenabled_at: null, changed_at: "t" }] } });
    await restoreSnapshot(env.DB, snap);
    expect((await env.DB.prepare("SELECT state, grant_version FROM obsidian_revocations").first())).toEqual({ state: "reenabled", grant_version: 2 });
  });
  it("after a database rollback, reconcile purges resurrected revoked text and rebuilds search", async () => {
    await upload("dev", doc(1));
    await upload("dev", doc(2));
    await revokeDocument(ID(1));
    // simulate a rollback that brought revoked content back
    await env.DB.prepare("INSERT INTO obsidian_chunks (id, document_id, sync_version, chunk_index, content) VALUES ('zombie', ?, 1, 0, 'resurrected polymorphism')").bind(ID(1)).run();
    await env.DB.prepare("INSERT INTO obsidian_fts (rowid, content) SELECT rowid, content FROM obsidian_chunks WHERE id = 'zombie'").run();
    await env.DB.prepare("UPDATE obsidian_documents SET status = 'synced', sync_version = 1 WHERE id = ?").bind(ID(1)).run();
    await env.DB.prepare("DELETE FROM obsidian_fts").run(); // index lost with the rollback
    await reconcileAfterRestore();
    const hits = (await searchKnowledge({ q: "polymorphism" })).results.map((r) => r.document_id);
    expect(hits).toEqual([ID(2)]);
  });
  it("search is closed while reconciling", async () => {
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('obsidian_search_ready', '0')").run();
    await expect(searchKnowledge({ q: "anything" })).rejects.toThrow(/rebuilt/);
    await expect(readDocument(ID(1))).rejects.toThrow(/rebuilt/);
  });
});

describe("vault proposals and approval", () => {
  it("routes vault tools to the vault approval path", () => {
    expect(riskOf("propose_delete_folder", { path: "a" })).toBe("vault");
    expect(riskOf("propose_create_note", {})).toBe("vault");
    expect(riskOf("create_note", { title: "x" })).toBeNull();
    expect(riskOf("delete_note", { id: "1" })).toBe("delete");
  });
  it("queues an encrypted proposal and shows the owner a one-line summary", async () => {
    const q = await queueVaultProposal({ op: "create_note", payload: { path: "Programming/REST API.md", content: "# REST\nVERY-PRIVATE-TEXT" }, summary: "Create note Programming/REST API.md" });
    const row = await env.DB.prepare("SELECT payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first<{ payload_enc: string }>();
    expect(row!.payload_enc.startsWith("v1.")).toBe(true);
    expect(row!.payload_enc).not.toContain("PRIVATE");
    const pa = await repo.getPending(q.pending_id);
    expect(pa).toMatchObject({ risk: "vault", status: "pending", summary: "Create note Programming/REST API.md" });
    expect(JSON.stringify(pa)).not.toContain("PRIVATE");
    expect(JSON.stringify(await repo.listAudit())).not.toContain("PRIVATE");
    const preview = await previewCommand(q.pending_id);
    expect(preview!.payload).toMatchObject({ content: "# REST\nVERY-PRIVATE-TEXT" });
  });
  it("rejects oversized, malformed and unsafe proposals", async () => {
    await expect(queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "x".repeat(1024 * 1024 + 1) }, summary: "s" })).rejects.toThrow(/1 MB/);
    await expect(queueVaultProposal({ op: "create_note", payload: { path: "../a.md", content: "x" }, summary: "s" })).rejects.toThrow(/path/);
    await expect(queueVaultProposal({ op: "create_note", payload: { path: "a.txt", content: "x" }, summary: "s" })).rejects.toThrow(/\.md/);
    await expect(queueVaultProposal({ op: "edit_note", payload: { path: "a.md", new_content: "x" }, summary: "s" })).rejects.toThrow(/expected_hash/);
    await expect(queueVaultProposal({ op: "move_note", payload: { path: "a.md", new_path: "a.md" }, summary: "s" })).rejects.toThrow(/same/);
    await expect(queueVaultProposal({ op: "delete_folder", payload: { path: ".obsidian" }, summary: "s" })).rejects.toThrow();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM pending_actions").first<{ n: number }>())!.n).toBe(0);
  });
  it("refuses to queue when the encryption secret is missing", async () => {
    freshEnv();
    await expect(queueVaultProposal({ op: "create_folder", payload: { path: "X" }, summary: "s" })).rejects.toThrow(/OBSIDIAN_PAYLOAD_KEY/);
  });
  it("flags a proposal that contains a possible secret but still allows it", async () => {
    const q = await queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "key sk-ant-api03-abcdefghijklmnopqrstuvwx" }, summary: "Create note a.md" });
    expect(q.secret_findings).toBe(1);
    expect((await repo.getPending(q.pending_id))!.summary).toContain("not synced");
  });
  it("nothing is offered to the Mac before approval; approval makes it claimable exactly once", async () => {
    const q = await queueVaultProposal({ op: "edit_note", payload: { path: "a.md", new_content: "new", expected_hash: "h1" }, summary: "Edit note a.md" });
    expect(await pollCommands()).toEqual([]);
    expect(await claimCommand("devA", q.command_id)).toBeNull();
    const ok = await approvePending(q.pending_id, "+07:00");
    expect(ok?.status).toBe("approved");
    expect(await approvePending(q.pending_id, "+07:00")).toBeNull(); // no double approval
    expect(await pollCommands()).toMatchObject([{ id: q.command_id, op: "edit_note" }]);
    const claimed = await claimCommand("devA", q.command_id);
    expect(claimed).toMatchObject({ op: "edit_note", expected_hash: "h1", payload: { new_content: "new" } });
    expect(await claimCommand("devB", q.command_id)).toBeNull(); // second claim loses
    expect(await pollCommands()).toEqual([]);
  });
  it("a rejected proposal is wiped and cannot be claimed", async () => {
    const q = await queueVaultProposal({ op: "delete_note", payload: { path: "a.md" }, summary: "Delete note a.md" });
    await rejectPending(q.pending_id);
    const row = await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first();
    expect(row).toEqual({ status: "rejected", payload_enc: null });
    expect(await approvePending(q.pending_id, "+07:00")).toBeNull();
  });
  it("applied: the proposal text is deleted and the audit log has no content", async () => {
    const q = await queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "BODY-TEXT" }, summary: "Create note a.md" });
    await approvePending(q.pending_id, "+07:00");
    await claimCommand("devA", q.command_id);
    expect(await reportResult("devB", q.command_id, { status: "applied" })).toBeNull(); // not the claimer
    expect(await reportResult("devA", q.command_id, { status: "applied" })).toEqual({ id: q.command_id, status: "applied" });
    expect(await reportResult("devA", q.command_id, { status: "applied" })).toBeNull(); // no duplicate result
    const row = await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first();
    expect(row).toEqual({ status: "applied", payload_enc: null });
    const log = JSON.stringify(await repo.listAudit());
    expect(log).toContain("Applied");
    expect(log).not.toContain("BODY-TEXT");
  });
  it("conflict: nothing applied, owner told to ask again, only the diff is kept", async () => {
    const q = await queueVaultProposal({ op: "edit_note", payload: { path: "a.md", new_content: "n", expected_hash: "old" }, summary: "Edit note a.md" });
    await approvePending(q.pending_id, "+07:00");
    await claimCommand("devA", q.command_id);
    await reportResult("devA", q.command_id, { status: "conflict", message: "changed on the Mac", conflict: { diff: "-a\n+b" } });
    expect((await repo.getPending(q.pending_id))).toMatchObject({ status: "failed" });
    expect((await previewCommand(q.pending_id))!).toMatchObject({ status: "conflict", payload: { diff: "-a\n+b" } });
    expect(await pollCommands()).toEqual([]);
  });
  it("failed: marked failed with a short message", async () => {
    const q = await queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "x" }, summary: "Create note a.md" });
    await approvePending(q.pending_id, "+07:00");
    await claimCommand("devA", q.command_id);
    await reportResult("devA", q.command_id, { status: "failed", message: "A note already exists at that path" });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "failed", note: "A note already exists at that path" });
  });
  it("a crashed Mac can retry a claimed command after 10 minutes, at most 3 times", async () => {
    vi.useFakeTimers();
    const q = await queueVaultProposal({ op: "delete_note", payload: { path: "a.md" }, summary: "Delete note a.md" });
    await approvePending(q.pending_id, "+07:00");
    expect(await claimCommand("devA", q.command_id)).not.toBeNull();
    expect(await claimCommand("devA", q.command_id)).toBeNull(); // still fresh
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await pollCommands()).toHaveLength(1);
    expect(await claimCommand("devA", q.command_id)).not.toBeNull(); // attempt 2
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await claimCommand("devA", q.command_id)).not.toBeNull(); // attempt 3
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await pollCommands()).toEqual([]);
    expect(await claimCommand("devA", q.command_id)).toBeNull();
  });
  const expiry: [string, Parameters<typeof queueVaultProposal>[0], number][] = [
    ["create_note", { op: "create_note", payload: { path: "a.md", content: "x" }, summary: "s" }, 30 * 86400],
    ["edit_note", { op: "edit_note", payload: { path: "a.md", new_content: "x", expected_hash: "h" }, summary: "s" }, 7 * 86400],
    ["create_folder", { op: "create_folder", payload: { path: "A" }, summary: "s" }, 30 * 86400],
    ["rename_folder", { op: "rename_folder", payload: { path: "A", new_path: "B" }, summary: "s" }, 7 * 86400],
    ["move_folder", { op: "move_folder", payload: { path: "A", new_path: "B/A" }, summary: "s" }, 7 * 86400],
    ["rename_note", { op: "rename_note", payload: { path: "a.md", new_path: "b.md" }, summary: "s" }, 7 * 86400],
    ["move_note", { op: "move_note", payload: { path: "a.md", new_path: "B/a.md" }, summary: "s" }, 7 * 86400],
    ["delete_note", { op: "delete_note", payload: { path: "a.md" }, summary: "s" }, 86400],
    ["delete_folder", { op: "delete_folder", payload: { path: "A" }, summary: "s" }, 86400],
  ];
  it.each(expiry)("%s uses its own expiry, counted from approval", async (_name, input, ttl) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    const q = await queueVaultProposal(input);
    const created = Date.parse("2026-11-11T00:00:00Z");
    // approved after waiting a while: the clock restarts at approval
    vi.setSystemTime(created + (ttl * 1000) / 2);
    await approvePending(q.pending_id, "+07:00");
    const row = await env.DB.prepare("SELECT approved_at, expires_at FROM obsidian_commands WHERE id = ?").bind(q.command_id).first<{ approved_at: string; expires_at: string }>();
    expect(Date.parse(row!.expires_at) - Date.parse(row!.approved_at)).toBe(ttl * 1000);
    vi.setSystemTime(Date.parse(row!.expires_at) + 1000);
    expect(await pollCommands()).toEqual([]);
    expect(await claimCommand("devA", q.command_id)).toBeNull();
    await expireCommands();
    const after = await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first();
    expect(after).toEqual({ status: "expired", payload_enc: null });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "expired" });
  });
  it("an unapproved proposal expires too, and cannot be approved afterwards", async () => {
    vi.useFakeTimers();
    const q = await queueVaultProposal({ op: "delete_folder", payload: { path: "A" }, summary: "Delete folder A" });
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    expect(await repo.listPending()).toEqual([]);
    expect(await approvePending(q.pending_id, "+07:00")).toBeNull();
    // a create note proposal outlives the 7 day default of ordinary approvals
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    const c = await queueVaultProposal({ op: "create_note", payload: { path: "n.md", content: "x" }, summary: "Create n" });
    vi.setSystemTime(Date.now() + 20 * 86400_000);
    expect((await repo.listPending()).map((p) => p.id)).toEqual([c.pending_id]);
    expect(await approvePending(c.pending_id, "+07:00")).not.toBeNull();
  });
  it("lists commands for the owner without content", async () => {
    await queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "TOPSECRETBODY" }, summary: "Create note a.md" });
    expect(JSON.stringify(await listCommands())).not.toContain("TOPSECRETBODY");
  });
  it("polling is a single indexed read", async () => {
    const plan = (await env.DB.prepare("EXPLAIN QUERY PLAN SELECT id, op FROM obsidian_commands WHERE status IN ('approved', 'claimed') AND expires_at > ? ORDER BY approved_at LIMIT 10").bind("x").all()).results as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toMatch(/idx_obs_cmd_poll/);
    // an empty poll writes nothing
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_commands").first();
    await pollCommands();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_commands").first()).toEqual(before);
  });
});

describe("status for the owner", () => {
  it("summarises documents, findings and queued work without names", async () => {
    await upload("dev", doc(1));
    await queueVaultProposal({ op: "create_folder", payload: { path: "X" }, summary: "Create folder X" });
    const s = await getObsidianStatus();
    expect(s.documents).toEqual([{ status: "synced", kind: "note", n: 1 }]);
    expect(s.commands).toEqual([{ status: "awaiting_approval", n: 1 }]);
    expect(s.approvals_configured).toBe(true);
    expect(s.search_ready).toBe(true);
  });
  it("SyncRejected is an Error", () => {
    expect(new SyncRejected("revoked", "x")).toBeInstanceOf(Error);
  });
});

describe("code review fixes", () => {
  const NOTE_WITH_SECRET = 'Setup notes\n\npassword = "hunter2hunter2"\n\nmore text';
  const secretDoc = (hash: string, extra: Partial<UploadInput> = {}) => doc(1, { content_hash: hash, chunks: [{ index: 0, content: 'Setup notes\n\npassword = "hunter2hunter2"\n\nmore text' }], ...extra });

  it("1. an approved finding lets the same content sync, and only that content", async () => {
    await expect(upload("dev", secretDoc("hash-a"))).rejects.toMatchObject({ code: "blocked_secret" });
    const [f] = await listFindings();
    // the Mac scanned the whole note, so its fingerprint must match what the Worker computes for the uploaded text
    expect(scanForSecrets(NOTE_WITH_SECRET)[0].fingerprint).toBe(scanForSecrets(`Note 1\n${NOTE_WITH_SECRET}`)[0].fingerprint);
    expect(await exceptFinding(f.id)).toBe(true);
    // the Worker keeps the approved finding when the same content is reported blocked again
    await upload("dev", secretDoc("hash-a", { sync_version: 1 })).then((r) => expect(r.status).toBe("synced"));
    expect((await listFindings()).filter((x) => x.status === "excepted")).toHaveLength(1);
    expect((await searchKnowledge({ q: "Setup notes" })).results).toHaveLength(1);
    // re-uploading the same approved content later still works
    await upload("dev", secretDoc("hash-a", { sync_version: 2 }));
    // changed content (new hash): the old approval no longer applies
    await expect(upload("dev", secretDoc("hash-b", { sync_version: 3 }))).rejects.toMatchObject({ code: "blocked_secret" });
    expect((await listFindings()).map((x) => x.status)).toEqual(["open"]);
  });
  it("1. a second, different secret is still blocked after one was approved", async () => {
    await expect(upload("dev", secretDoc("hash-a"))).rejects.toMatchObject({ code: "blocked_secret" });
    await exceptFinding((await listFindings())[0].id);
    const two = secretDoc("hash-a", { chunks: [{ index: 0, content: 'password = "hunter2hunter2"\napi_key = "zzzzzzzz9999"' }] });
    await expect(upload("dev", two)).rejects.toMatchObject({ code: "blocked_secret" });
  });

  const hookBatch = (n: number, fn: () => Promise<unknown>) => {
    const orig = env.DB.batch.bind(env.DB);
    let calls = 0;
    env.DB.batch = (async (stmts: D1PreparedStatement[]) => {
      calls++;
      if (calls === n) await fn();
      return orig(stmts);
    }) as typeof env.DB.batch;
  };
  it("2. a revoke that lands before the upload's writes keeps the note out", async () => {
    await upload("dev", doc(1));
    hookBatch(1, () => revokeDocument(ID(1)));
    await expect(upload("dev", doc(1, { sync_version: 2, chunks: [{ index: 0, content: "late polymorphism text" }] }))).rejects.toMatchObject({ code: "revoked" });
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_chunks").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT status FROM obsidian_documents").first<{ status: string }>())!.status).toBe("blocked_revoked");
  });
  it("2. a revoke between staging and commit keeps the note out", async () => {
    hookBatch(2, () => revokeDocument(ID(1)));
    await expect(upload("dev", doc(1))).rejects.toMatchObject({ code: "revoked" });
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
    expect(await readDocument(ID(1))).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM obsidian_fts").first<{ n: number }>())!.n).toBe(0);
  });
  it("2. a late part of a deleted or replaced upload is refused", async () => {
    await upload("dev", { ...doc(1, { total_chunks: 2, chunks: [{ index: 0, content: "first half" }] }), part: 0 });
    await removeDocument(ID(1));
    await expect(upload("dev", { ...doc(1, { total_chunks: 2, chunks: [{ index: 1, content: "second half" }] }), part: 1 })).rejects.toMatchObject({ code: "stale_version" });
    expect((await searchKnowledge({ q: "half" })).results).toEqual([]);
    await upload("dev", { ...doc(2, { total_chunks: 2, chunks: [{ index: 0, content: "one" }] }), part: 0 });
    await upload("dev", { ...doc(2, { sync_version: 2, total_chunks: 1 }), part: 0 });
    await expect(upload("dev", { ...doc(2, { total_chunks: 2, chunks: [{ index: 1, content: "two" }] }), part: 1 })).rejects.toMatchObject({ code: "stale_version" });
  });

  it("3. the poll cursor lags so a revocation committed just after a read is not skipped", async () => {
    const { code } = await createPairingCode();
    const { token } = await completePairing({ code, name: "Mac" });
    const { GET } = await import("@/app/api/obsidian/bridge/poll/route");
    const poll = async (since?: string) => {
      const res = await GET(new Request(`http://x/api/obsidian/bridge/poll${since ? `?rev_since=${encodeURIComponent(since)}` : ""}`, { headers: { authorization: `Bearer ${token}` } }), undefined as never);
      return (await res.json()) as { now: string; cursor: string; revocations: { document_id: string }[] };
    };
    const first = await poll();
    expect(Date.parse(first.now) - Date.parse(first.cursor)).toBe(60_000);
    await revokeDocument(ID(1));
    const second = await poll(first.cursor);
    expect(second.revocations.map((r) => r.document_id)).toEqual([ID(1)]);
    // even the cursor from the poll that already delivered it still returns it once more (idempotent for the Bridge)
    expect((await poll(second.cursor)).revocations.map((r) => r.document_id)).toEqual([ID(1)]);
  });

  it("4. a revoked device polling does not lock out a freshly paired one", async () => {
    const h = deviceApi(async () => Response.json({ ok: true }));
    const call = (token: string) => h(new Request("http://x/", { headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": "7.7.7.7" } }), undefined as never);
    const a = await completePairing({ code: (await createPairingCode()).code, name: "Old Mac" });
    await revokeDevice(a.device_id);
    for (let i = 0; i < 10; i++) expect((await call(a.token)).status).toBe(401);
    expect(await (await call(a.token)).json()).toEqual({ error: "device_revoked" });
    const b = await completePairing({ code: (await createPairingCode()).code, name: "New Mac" });
    expect((await call(b.token)).status).toBe(200);
  });
  it("4. a valid token still works from an IP that was locked by wrong tokens", async () => {
    const h = deviceApi(async () => Response.json({ ok: true }));
    const call = (token: string) => h(new Request("http://x/", { headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": "6.6.6.6" } }), undefined as never);
    for (let i = 0; i < 5; i++) await call("never-issued-token-never-issued");
    expect((await call("never-issued-token-never-issued")).status).toBe(429);
    const d = await completePairing({ code: (await createPairingCode()).code, name: "Mac" });
    expect((await call(d.token)).status).toBe(200);
  });

  const pdfDoc = (id: string) => ({ ...doc(50, { id, kind: "pdf", title: "Lecture", path: "Uni/lecture.pdf", chunks: [{ index: 0, page: 1, content: "Normalization removes redundancy" }] }), pdf: { state: "completed" as const, pages: 1 } });
  it("5. a PDF uploaded just before its note is not removed by another note's commit", async () => {
    const pdf = "pdf:" + "c".repeat(32);
    await upload("dev", pdfDoc(pdf));
    await upload("dev", doc(2, { pdf_refs: [] })); // another note commits first
    await upload("dev", doc(3)); // and another without any PDF list
    expect((await searchKnowledge({ q: "normalization" })).results).toHaveLength(1);
    await upload("dev", doc(1, { pdf_refs: [pdf] }));
    expect((await searchKnowledge({ q: "normalization" })).results).toHaveLength(1);
    // dropping the reference removes the PDF text, and only then
    await upload("dev", doc(1, { sync_version: 2, pdf_refs: [] }));
    expect((await searchKnowledge({ q: "normalization" })).results).toEqual([]);
  });
  it("5. PDFs that are still syncing or blocked are never garbage collected", async () => {
    const pdf = "pdf:" + "d".repeat(32);
    await upload("dev", { ...pdfDoc(pdf), total_chunks: 2, chunks: [{ index: 0, content: "half a pdf" }], part: 0 });
    await upload("dev", doc(1, { pdf_refs: [pdf] }));
    await upload("dev", doc(1, { sync_version: 2, pdf_refs: [] }));
    expect((await env.DB.prepare("SELECT status FROM obsidian_documents WHERE id = ?").bind(pdf).first<{ status: string }>())!.status).toBe("syncing");
  });

  it("6. a failed reconcile keeps search closed, and running it again recovers", async () => {
    await upload("dev", doc(1));
    const orig = env.DB.prepare.bind(env.DB);
    let fail = true;
    env.DB.prepare = ((sql: string) => {
      if (fail && sql === "DELETE FROM obsidian_fts") throw new Error("D1 timeout");
      return orig(sql);
    }) as typeof env.DB.prepare;
    await expect(reconcileAfterRestore()).rejects.toThrow(/timeout/);
    await expect(searchKnowledge({ q: "polymorphism" })).rejects.toThrow(/rebuilt/);
    expect((await getObsidianStatus()).search_ready).toBe(false);
    fail = false;
    await reconcileAfterRestore();
    expect((await searchKnowledge({ q: "polymorphism" })).results).toHaveLength(1);
  });

  it("7. the tag filter matches whole tags only", async () => {
    await upload("dev", doc(1, { tags: ["javascript"], chunks: [{ index: 0, content: "shared words here" }] }));
    await upload("dev", doc(2, { tags: ["java"], chunks: [{ index: 0, content: "shared words here" }] }));
    await upload("dev", doc(3, { tags: ["a\"b%_c"], chunks: [{ index: 0, content: "shared words here" }] }));
    expect((await searchKnowledge({ q: "shared words", tag: "java" })).results.map((r) => r.title)).toEqual(["Note 2"]);
    expect((await searchKnowledge({ q: "shared words", tag: "script" })).results).toEqual([]);
    expect((await searchKnowledge({ q: "shared words", tag: 'a"b%_c' })).results.map((r) => r.title)).toEqual(["Note 3"]);
    expect((await searchKnowledge({ q: "shared words", tag: "a" })).results).toEqual([]);
  });

  it("8. busy claimed commands do not hide newer approved ones", async () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      const q = await queueVaultProposal({ op: "create_folder", payload: { path: `F${i}` }, summary: `Create folder F${i}` });
      await approvePending(q.pending_id, "+07:00");
      ids.push(q.command_id);
      vi.setSystemTime(Date.now() + 1000);
    }
    for (const id of ids.slice(0, 10)) await claimCommand("devA", id); // ten fresh claims
    const polled = await pollCommands();
    expect(polled.map((c) => c.id)).toEqual([ids[10]]);
  });
  it("8. a command that used all its tries is closed as failed, and the approval row says so", async () => {
    vi.useFakeTimers();
    const q = await queueVaultProposal({ op: "delete_note", payload: { path: "a.md" }, summary: "Delete note a.md" });
    await approvePending(q.pending_id, "+07:00");
    for (let i = 0; i < 3; i++) {
      expect(await claimCommand("devA", q.command_id)).not.toBeNull();
      vi.setSystemTime(Date.now() + 11 * 60_000);
    }
    expect(await pollCommands()).toEqual([]);
    await expireCommands();
    expect(await env.DB.prepare("SELECT status, payload_enc FROM obsidian_commands WHERE id = ?").bind(q.command_id).first()).toEqual({ status: "failed", payload_enc: null });
    expect(await repo.getPending(q.pending_id)).toMatchObject({ status: "failed" });
    expect((await repo.getPending(q.pending_id))!.note).toMatch(/never reported/);
  });

  it("9. re-uploading a synced note keeps the old copy searchable until the new one is complete", async () => {
    await upload("dev", doc(1));
    const r = await upload("dev", { ...doc(1, { sync_version: 2, total_chunks: 2, chunks: [{ index: 0, content: "brand new part one" }] }), part: 0 });
    expect(r.status).toBe("syncing");
    expect((await searchKnowledge({ q: "polymorphism" })).results).toHaveLength(1); // old copy still there
    expect((await searchKnowledge({ q: "brand new" })).results).toEqual([]);
    await upload("dev", { ...doc(1, { sync_version: 2, total_chunks: 2, chunks: [{ index: 1, content: "part two" }] }), part: 1 });
    expect((await searchKnowledge({ q: "polymorphism" })).results).toEqual([]);
    expect((await searchKnowledge({ q: "brand new" })).results).toHaveLength(1);
  });
  it("9. paths are stored in NFC, and hidden or trash paths are refused", async () => {
    const nfd = "Languages/ที่.md".normalize("NFD");
    await upload("dev", doc(1, { path: nfd }));
    const stored = (await env.DB.prepare("SELECT path FROM obsidian_documents").first<{ path: string }>())!.path;
    expect(stored).toBe(nfd.normalize("NFC"));
    expect(() => validateVaultPath(".trash/x.md", { kind: "note" })).toThrow(/trash/);
    expect(() => validateVaultPath("a/x.md", { kind: "pdf" })).toThrow(/\.pdf/);
    await expect(upload("dev", doc(2, { path: ".trash/old.md" }))).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("approval screen data", () => {
  it("lists commands with their summary and no content", async () => {
    await upload("dev", doc(1));
    await queueVaultProposal({ op: "create_note", payload: { path: "a.md", content: "TOPSECRETBODY" }, summary: "Create note “a.md” (13 characters)" });
    const list = (await listCommands()) as { summary: string | null; status: string }[];
    expect(list[0]).toMatchObject({ summary: "Create note “a.md” (13 characters)", status: "awaiting_approval" });
    expect(JSON.stringify(list)).not.toContain("TOPSECRETBODY");
  });
  it("preview for an edit includes the summary, lifetime and the proposed text", async () => {
    const q = await queueVaultProposal({ op: "edit_note", payload: { path: "a.md", new_content: "new body", expected_hash: "h" }, summary: "Edit note “a.md”" });
    const p = await previewCommand(q.pending_id);
    expect(p).toMatchObject({ op: "edit_note", summary: "Edit note “a.md”", ttl_seconds: 7 * 86400, payload: { new_content: "new body" } });
  });
});
