import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/cloudflare/client.js";
import { findNoteById, setSyncFlag, syncVault, SyncNotConfirmedError } from "../src/sync/engine.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { FakeApi, hasNative, ID, makePdf, makeCtx, makeVault, NOTE } from "./helpers/vault.js";

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});
async function setup(over = {}) {
  const v = await makeVault();
  cleanups.push(v.cleanup);
  const api = new FakeApi();
  const ctx = makeCtx(v.dir, api, over);
  return { v, api, ctx };
}

describe("selective sync", () => {
  it("never uploads before the initial sync is confirmed", async () => {
    const { v, api, ctx } = await setup({ initialSyncConfirmedAt: undefined });
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    await expect(syncVault(ctx)).rejects.toThrow(SyncNotConfirmedError);
    expect(api.calls).toEqual([]);
    expect(await readFile(join(v.dir, "a.md"), "utf8")).toBe(NOTE(ID(1), true, "hello")); // nothing written either
  });
  it("uploads only notes flagged true; folder membership and links do not share anything", async () => {
    const { v, api, ctx } = await setup();
    await v.write("Programming/Java/shared.md", NOTE(ID(1), true, "# Java OOP\nSee [[Personal Thoughts]]\n"));
    await v.write("Programming/Java/not-flagged.md", "in the same folder, no flag");
    await v.write("Personal Thoughts.md", NOTE(ID(2), false, "my very private diary"));
    const r = await syncVault(ctx);
    expect(r.uploaded).toBe(1);
    expect([...api.docs.keys()]).toEqual([ID(1)]);
    expect(api.text(ID(1))).toContain("[[Personal Thoughts]]");
    expect(JSON.stringify([...api.docs.values()])).not.toContain("private diary");
  });
  it("gives a shared note without an id a UUID, changing only that line", async () => {
    const { v, api, ctx } = await setup();
    const original = "---\r\ntitle: Keep me\r\nlifeos_sync: true\r\n---\r\n# Body\r\n\r\ntext  here\r\n";
    await v.write("n.md", original);
    const r = await syncVault(ctx);
    const after = await readFile(join(v.dir, "n.md"), "utf8");
    const id = parseNote(after).id!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(after).toBe(original.replace("lifeos_sync: true\r\n", `lifeos_sync: true\r\nid: ${id}\r\n`));
    expect(r.idsAssigned).toBe(1);
    expect(api.docs.has(id)).toBe(true);
    // the id is stable across more syncs
    await syncVault(ctx);
    expect(parseNote(await readFile(join(v.dir, "n.md"), "utf8")).id).toBe(id);
  });
  it("reports invalid and duplicate ids and syncs neither", async () => {
    const { v, api, ctx } = await setup();
    await v.write("bad.md", NOTE("not-a-uuid", true, "x"));
    await v.write("d1.md", NOTE(ID(5), true, "one"));
    await v.write("d2.md", NOTE(ID(5), true, "two"));
    await v.write("ok.md", NOTE(ID(6), true, "fine"));
    const r = await syncVault(ctx);
    expect(r.blocked).toMatchObject({ invalidId: 1, duplicateId: 2 });
    expect([...api.docs.keys()]).toEqual([ID(6)]);
    expect(await readFile(join(v.dir, "bad.md"), "utf8")).toContain("id: not-a-uuid"); // never overwritten
  });
});

describe("incremental sync", () => {
  it("sends only what changed", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "one"));
    await v.write("b.md", NOTE(ID(2), true, "two"));
    expect((await syncVault(ctx)).uploaded).toBe(2);
    api.calls.length = 0;
    expect((await syncVault(ctx)).unchanged).toBe(2);
    expect(api.calls).toEqual([]);
    await v.write("a.md", NOTE(ID(1), true, "one changed"));
    const r = await syncVault(ctx);
    expect(r).toMatchObject({ uploaded: 1, unchanged: 1 });
    expect(api.calls).toEqual([`upload:${ID(1)}:0`]);
    expect(api.text(ID(1))).toContain("one changed");
    expect(api.docs.get(ID(1))!.body.sync_version).toBe(2);
  });
  it("a rename or move keeps the identity and only updates the path", async () => {
    const { v, api, ctx } = await setup();
    await v.write("Inbox/a.md", NOTE(ID(1), true, "stable"));
    await syncVault(ctx);
    api.calls.length = 0;
    await mkdir(join(v.dir, "Programming"));
    await rename(join(v.dir, "Inbox/a.md"), join(v.dir, "Programming/Java OOP.md"));
    const r = await syncVault(ctx);
    expect(r).toMatchObject({ pathUpdates: 1, uploaded: 0, removed: 0 });
    expect(api.calls).toEqual([`path:${ID(1)}`]);
    expect(api.docs.get(ID(1))!.path).toBe("Programming/Java OOP.md");
  });
  it("removes a deleted note, and one whose flag was switched off", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "one"));
    await v.write("b.md", NOTE(ID(2), true, "two"));
    await v.write("c.md", NOTE(ID(3), true, "three"));
    await syncVault(ctx);
    await rm(join(v.dir, "a.md"));
    await v.write("b.md", NOTE(ID(2), false, "two"));
    const r = await syncVault(ctx);
    expect(r.removed).toBe(2);
    expect([...api.docs.keys()]).toEqual([ID(3)]);
  });
  it("a missing vault does not wipe the cloud copy (safety brake)", async () => {
    const { v, api, ctx } = await setup();
    for (let i = 1; i <= 15; i++) await v.write(`n${i}.md`, NOTE(ID(i), true, `note ${i}`));
    await syncVault(ctx);
    for (let i = 1; i <= 14; i++) await rm(join(v.dir, `n${i}.md`));
    const r = await syncVault(ctx);
    expect(r.removalBrake).toBe(true);
    expect(r.removed).toBe(0);
    expect(api.removed).toEqual([]);
  });
  it("big notes are uploaded in bounded parts with headings", async () => {
    const { v, api, ctx } = await setup();
    const body = Array.from({ length: 120 }, (_, i) => `## Section ${i}\n${"word ".repeat(900)}`).join("\n");
    await v.write("big.md", NOTE(ID(1), true, body));
    await syncVault(ctx);
    const parts = api.calls.filter((c) => c.startsWith("upload:"));
    expect(parts.length).toBeGreaterThan(1);
    const doc = api.docs.get(ID(1))!;
    expect(doc.chunks.length).toBeGreaterThan(50);
    expect(doc.chunks.every((c) => c.content.length <= 4000)).toBe(true);
    expect(doc.chunks.some((c) => c.heading === "Section 7")).toBe(true);
  });
  it("jumps ahead when the cloud already has a newer version number", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "v1"));
    await syncVault(ctx);
    ctx.state.docs = {}; // lost local state (e.g. re-paired)
    await v.write("a.md", NOTE(ID(1), true, "v2"));
    await syncVault(ctx);
    expect(api.docs.get(ID(1))!.body.sync_version).toBe(2);
    expect(api.text(ID(1))).toContain("v2");
  });
  it("stops the pass on a transient error so it can be retried, and keeps state clean", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "x"));
    api.failWith = new ApiError(500, "server_error", "D1 quota");
    await expect(syncVault(ctx)).rejects.toThrow(/quota/);
    expect(ctx.state.docs[ID(1)]).toBeUndefined();
    api.failWith = null;
    expect((await syncVault(ctx)).uploaded).toBe(1);
  });
});

describe("secret protection", () => {
  it("holds a note back, reports only masked findings, and keeps it locally", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, 'API key: sk-ant-api03-abcdefghijklmnopqrstuvwx\nmore'));
    await v.write("b.md", NOTE(ID(2), true, "clean"));
    const r = await syncVault(ctx);
    expect(r.blocked.secret).toBe(1);
    expect(api.docs.has(ID(1))).toBe(false);
    expect(api.blocked).toEqual([{ id: ID(1), kind: "note", findings: 1 }]);
    expect(ctx.state.docs[ID(1)].status).toBe("blocked_secret");
    expect(await readFile(join(v.dir, "a.md"), "utf8")).toContain("sk-ant-api03"); // the local note is untouched
  });
  it("a per-finding exception lets it sync, but only for that exact content", async () => {
    const { v, api, ctx } = await setup();
    const text = (extra: string) => NOTE(ID(1), true, `password = "hunter2hunter2"\n${extra}`);
    await v.write("a.md", text("v1"));
    await syncVault(ctx);
    expect(api.docs.has(ID(1))).toBe(false);
    const { scanForSecrets } = await import("../src/shared/secrets.js");
    const { sha256 } = await import("../src/vault/scan.js");
    const fp = scanForSecrets(`a\npassword = "hunter2hunter2"\nv1`)[0].fingerprint;
    ctx.state.exceptions.push({ docId: ID(1), fingerprint: fp, contentHash: sha256(text("v1")) });
    await syncVault(ctx);
    expect(api.docs.has(ID(1))).toBe(true);
    await v.write("a.md", text("v2 changed")); // new content: the approval no longer applies
    api.docs.clear();
    ctx.state.docs = {};
    await syncVault(ctx);
    expect(api.docs.has(ID(1))).toBe(false);
  });
  it("a second, different secret is not covered by the first approval", async () => {
    const { v, api, ctx } = await setup();
    const body = 'password = "hunter2hunter2"\napi_key = "zzzzzzzz9999"';
    await v.write("a.md", NOTE(ID(1), true, body));
    const { scanForSecrets } = await import("../src/shared/secrets.js");
    const { sha256 } = await import("../src/vault/scan.js");
    const [first] = scanForSecrets(body);
    ctx.state.exceptions.push({ docId: ID(1), fingerprint: first.fingerprint, contentHash: sha256(NOTE(ID(1), true, body)) });
    await syncVault(ctx);
    expect(api.docs.has(ID(1))).toBe(false);
  });
  it("images are never uploaded, only a placeholder", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "Look: ![[java-architecture.png]] and ![x](./pic.jpg)"));
    await v.write("java-architecture.png", Buffer.from([1, 2, 3]));
    await syncVault(ctx);
    expect(api.text(ID(1))).toContain("[Image attachment: java-architecture.png — not synchronized]");
    expect(api.text(ID(1))).not.toContain("![[java-architecture.png]]");
  });
});

describe("revocation from LifeOS", () => {
  it("a refused upload turns the flag off locally and the note stays out until re-enabled", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    api.refuse.add(ID(1));
    const r = await syncVault(ctx);
    expect(r.blocked.revoked).toBe(1);
    expect(parseNote(await readFile(join(v.dir, "a.md"), "utf8")).sync).toBe(false);
    api.refuse.clear();
    expect((await syncVault(ctx)).uploaded).toBe(0); // flag is off now
  });
  it("a note the owner revoked is not uploaded even if its file still says true", async () => {
    const { v, api, ctx } = await setup();
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    ctx.state.revoked[ID(1)] = 1;
    const r = await syncVault(ctx);
    expect(r.blocked.revoked).toBe(1);
    expect(api.calls).toEqual([]);
  });
  it("can find a note by id to switch its flag", async () => {
    const { v } = await setup();
    await v.write("deep/folder/a.md", NOTE(ID(9), true, "x"));
    const abs = (await findNoteById(v.dir, ID(9)))!;
    await setSyncFlag(abs, false);
    expect(parseNote(await readFile(abs, "utf8")).sync).toBe(false);
    expect(await findNoteById(v.dir, ID(10))).toBeNull();
    await writeFile(join(v.dir, "x.md"), "");
  });
});

describe.skipIf(!hasNative)("PDF text", () => {
  it("extracts Thai, English and Japanese text with page numbers and syncs it once for several notes", async () => {
    const { v, api, ctx } = await setup();
    makePdf(join(v.dir, "thai.pdf"), "Thonburi", "การเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลัก", "หน้าที่สอง ฐานข้อมูลเชิงสัมพันธ์");
    makePdf(join(v.dir, "en.pdf"), "Helvetica", "Normalization removes redundancy in relational databases");
    makePdf(join(v.dir, "jp.pdf"), "Hiragino Sans", "データベース設計の基本を学ぶ");
    await v.write("n1.md", NOTE(ID(1), true, "![[thai.pdf]] [[en.pdf]] [jp](./jp.pdf)"));
    await v.write("n2.md", NOTE(ID(2), true, "![[thai.pdf]]"));
    const r = await syncVault(ctx);
    expect(r.pdfsUploaded).toBe(3); // thai.pdf once, even though two notes reference it
    const pdfs = [...api.docs.values()].filter((d) => d.body.kind === "pdf");
    const thai = pdfs.find((p) => p.body.path === "thai.pdf")!;
    expect(thai.chunks.map((c) => [c.page, c.content])).toEqual([[1, "การเขียนโปรแกรมเชิงวัตถุ คือแนวคิดหลัก"], [2, "หน้าที่สอง ฐานข้อมูลเชิงสัมพันธ์"]]);
    expect(thai.body.pdf).toMatchObject({ state: "completed", pages: 2 });
    expect(pdfs.find((p) => p.body.path === "en.pdf")!.chunks[0].content).toContain("Normalization");
    expect(pdfs.find((p) => p.body.path === "jp.pdf")!.chunks[0].content).toBe("データベース設計の基本を学ぶ");
    expect(api.docs.get(ID(1))!.body.pdf_refs).toHaveLength(3);
    expect(api.docs.get(ID(2))!.body.pdf_refs).toEqual([thai.body.id]);
    // nothing changes, nothing is re-processed
    api.calls.length = 0;
    await syncVault(ctx);
    expect(api.calls).toEqual([]);
  });
  it("a changed PDF is extracted again", async () => {
    const { v, api, ctx } = await setup();
    makePdf(join(v.dir, "a.pdf"), "Helvetica", "first version text");
    await v.write("n.md", NOTE(ID(1), true, "![[a.pdf]]"));
    await syncVault(ctx);
    makePdf(join(v.dir, "a.pdf"), "Helvetica", "second version text");
    await syncVault(ctx);
    const pdfs = [...api.docs.values()].filter((d) => d.body.kind === "pdf");
    expect(pdfs.map((p) => p.chunks[0].content).sort()).toEqual(["first version text", "second version text"]);
  });
  it("marks an image-only PDF as no_text without sending any text, and a corrupt one as failed", async () => {
    const { v, api, ctx } = await setup();
    makePdf(join(v.dir, "scan.pdf"), "none", "");
    await writeFile(join(v.dir, "broken.pdf"), "this is not a pdf");
    await v.write("n.md", NOTE(ID(1), true, "![[scan.pdf]] ![[broken.pdf]]"));
    const r = await syncVault(ctx);
    expect(r.pdfIssues).toMatchObject({ no_text: 1, failed: 1 });
    const pdfs = [...api.docs.values()].filter((d) => d.body.kind === "pdf");
    expect(pdfs.find((p) => p.body.path === "scan.pdf")!.body.pdf!.state).toBe("no_text");
    expect(pdfs.find((p) => p.body.path === "scan.pdf")!.chunks).toEqual([]);
    expect(pdfs.find((p) => p.body.path === "broken.pdf")!.body.pdf!.state).toBe("failed");
  });
  it("files over the limit get a too_large status and are never read", async () => {
    const { v, api, ctx } = await setup({ pdfMaxBytes: 2048 });
    await writeFile(join(v.dir, "huge.pdf"), Buffer.alloc(5000));
    await v.write("n.md", NOTE(ID(1), true, "![[huge.pdf]]"));
    const r = await syncVault(ctx);
    expect(r.pdfIssues.too_large).toBe(1);
    const huge = [...api.docs.values()].find((d) => d.body.path === "huge.pdf")!;
    expect(huge.body.pdf!.state).toBe("too_large");
    expect(huge.chunks).toEqual([]);
  });
  it("holds back PDF text that contains a secret", async () => {
    const { v, api, ctx } = await setup();
    makePdf(join(v.dir, "k.pdf"), "Helvetica", "config AKIAIOSFODNN7EXAMPLE leaked");
    await v.write("n.md", NOTE(ID(1), true, "![[k.pdf]] text"));
    const r = await syncVault(ctx);
    expect(r.blocked.secret).toBe(1);
    expect(api.blocked[0]).toMatchObject({ kind: "pdf" });
    expect([...api.docs.values()].some((d) => d.body.kind === "pdf")).toBe(false);
    expect(api.docs.has(ID(1))).toBe(true); // the note itself still syncs
  });
});
