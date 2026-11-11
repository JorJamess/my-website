import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaimedCommand } from "../src/cloudflare/client.js";
import { executeCommand, folderImpact, noBackupConfigured, type SafetyBackup } from "../src/approvals/executor.js";
import { lineDiff } from "../src/shared/diff.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { sha256 } from "../src/vault/scan.js";
import { silentLogger } from "../src/logging.js";
import { ID, makeVault, NOTE } from "./helpers/vault.js";
import type { BridgeConfig } from "../src/config/config.js";

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function setup(backup: SafetyBackup = async () => ({ ok: true })) {
  const v = await makeVault();
  cleanups.push(v.cleanup);
  const cfg: BridgeConfig = { version: 1, lifeosUrl: "https://x.test", vaultPath: v.dir, vaultName: "T", deviceName: "M", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8 };
  const backups: string[] = [];
  const deps = { cfg, log: silentLogger, safetyBackup: async (r: string) => (backups.push(r), backup(r)) };
  const run = (op: string, payload: Record<string, unknown>, over: Partial<ClaimedCommand> = {}) =>
    executeCommand({ id: "c1", op, payload, expected_hash: typeof payload.expected_hash === "string" ? payload.expected_hash : null, expires_at: new Date(Date.now() + 3600_000).toISOString(), secret_findings: 0, ...over }, deps);
  const list = async (dir = "") => (await readdir(join(v.dir, dir))).filter((n) => !n.startsWith(".")).sort();
  return { v, run, backups, list, cfg };
}

describe("create", () => {
  it("creates a note with a fresh id and lifeos_sync: true, without a safety backup", async () => {
    const { v, run, backups } = await setup();
    const r = await run("create_note", { path: "Programming/Web/REST API.md", content: "# REST API\n\nResources and verbs.\n" });
    expect(r).toMatchObject({ status: "applied" });
    const text = await readFile(join(v.dir, "Programming/Web/REST API.md"), "utf8");
    const p = parseNote(text);
    expect(p.sync).toBe(true);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.body).toBe("# REST API\n\nResources and verbs.\n");
    expect(backups).toEqual([]);
  });
  it("keeps a valid id Claude supplied, replaces an invalid one, and forces the flag on", async () => {
    const { v, run } = await setup();
    await run("create_note", { path: "a.md", content: NOTE(ID(3), false, "x") });
    expect(parseNote(await readFile(join(v.dir, "a.md"), "utf8"))).toMatchObject({ id: ID(3), sync: true });
    await run("create_note", { path: "b.md", content: NOTE("junk", false, "x") });
    expect(parseNote(await readFile(join(v.dir, "b.md"), "utf8")).id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("never overwrites and never invents a numbered name", async () => {
    const { v, run, list } = await setup();
    await v.write("n.md", "precious");
    const r = await run("create_note", { path: "n.md", content: "new" });
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/already exists/) });
    expect(await readFile(join(v.dir, "n.md"), "utf8")).toBe("precious");
    expect(await list()).toEqual(["n.md"]);
    // also true with different letter case (macOS is case-insensitive)
    expect((await run("create_note", { path: "N.md", content: "new" })).status).toBe("failed");
  });
  it("creates a note that may contain a secret, but says sync stays blocked", async () => {
    const { run } = await setup();
    const r = await run("create_note", { path: "k.md", content: "key sk-ant-api03-abcdefghijklmnopqrstuvwx" });
    expect(r).toMatchObject({ status: "applied", message: expect.stringMatching(/blocked/) });
  });
  it("creates a folder, but not over an existing one", async () => {
    const { run, list } = await setup();
    expect((await run("create_folder", { path: "Programming/Java" })).status).toBe("applied");
    expect(await list("Programming")).toEqual(["Java"]);
    expect((await run("create_folder", { path: "Programming/Java" })).status).toBe("failed");
  });
});

describe("safety rules", () => {
  it("refuses paths that leave the vault or touch .obsidian", async () => {
    const { v, run } = await setup();
    const outside = await makeVault();
    cleanups.push(outside.cleanup);
    await symlink(outside.dir, join(v.dir, "link"));
    for (const path of ["../x.md", ".obsidian/app.json", "link/x.md", "/etc/hosts.md"]) {
      expect((await run("create_note", { path, content: "x" })).status, path).toBe("failed");
    }
    expect((await readdir(outside.dir)).filter((n) => !n.startsWith("."))).toEqual([]);
    expect(await readFile(join(v.dir, ".obsidian/app.json"), "utf8")).toBe("{}");
  });
  it("does nothing once the approval has expired", async () => {
    const { run, list } = await setup();
    const r = await run("create_note", { path: "n.md", content: "x" }, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/Expired/) });
    expect(await list()).toEqual([]);
  });
  it("does not change or remove anything when the safety backup fails", async () => {
    const { v, run, list } = await setup(async () => ({ ok: false, message: "disk full" }));
    const text = NOTE(ID(1), true, "body");
    await v.write("n.md", text);
    await v.write("Old/x.md", "x");
    for (const [op, payload] of [
      ["edit_note", { path: "n.md", new_content: "new", expected_hash: sha256(text) }],
      ["delete_note", { path: "n.md" }],
      ["move_note", { path: "n.md", new_path: "m.md" }],
      ["rename_folder", { path: "Old", new_path: "New" }],
      ["delete_folder", { path: "Old" }],
    ] as const) {
      const r = await run(op, payload);
      expect(r, op).toMatchObject({ status: "failed", message: expect.stringMatching(/Safety backup failed/) });
    }
    expect(await readFile(join(v.dir, "n.md"), "utf8")).toBe(text);
    expect(await list()).toEqual(["Old", "n.md"]);
  });
  it("destructive changes are blocked until backups are configured", async () => {
    const { v, run } = await setup(noBackupConfigured);
    await v.write("n.md", "x");
    expect((await run("delete_note", { path: "n.md" })).status).toBe("failed");
    expect(await readFile(join(v.dir, "n.md"), "utf8")).toBe("x");
  });
});

describe("edit", () => {
  it("replaces the body, keeps the frontmatter and id, and makes a backup first", async () => {
    const { v, run, backups } = await setup();
    const text = NOTE(ID(1), true, "# Java OOP\nold text\n", "title: Keep\n");
    await v.write("n.md", text);
    const r = await run("edit_note", { path: "n.md", new_content: "# Java OOP\nnew text about Polymorphism\n", expected_hash: sha256(text) });
    expect(r.status).toBe("applied");
    const after = await readFile(join(v.dir, "n.md"), "utf8");
    expect(after).toBe(`---\nid: ${ID(1)}\nlifeos_sync: true\ntitle: Keep\n---\n# Java OOP\nnew text about Polymorphism\n`);
    expect(backups).toEqual(["edit_note"]);
  });
  it("stops with a diff when the file changed after the proposal, and keeps the local version", async () => {
    const { v, run } = await setup();
    const original = NOTE(ID(1), true, "line one\nline two\nline three\n");
    await v.write("n.md", original);
    const hash = sha256(original);
    const changed = NOTE(ID(1), true, "line one\nline two EDITED BY ME\nline three\n");
    await writeFile(join(v.dir, "n.md"), changed); // the owner edits while the Mac was offline
    const r = await run("edit_note", { path: "n.md", new_content: "line one\nline two\nline three\nand more\n", expected_hash: hash });
    expect(r.status).toBe("conflict");
    expect(r.conflict).toMatchObject({ current_hash: sha256(changed) });
    expect(String(r.conflict!.diff)).toContain("-line two EDITED BY ME");
    expect(String(r.conflict!.diff)).toContain("+and more");
    expect(await readFile(join(v.dir, "n.md"), "utf8")).toBe(changed);
  });
  it("treats a missing note as a refusal, not a crash", async () => {
    const { run } = await setup();
    expect((await run("edit_note", { path: "nope.md", new_content: "x", expected_hash: "h" })).status).toBe("failed");
  });
});

describe("rename, move, delete", () => {
  it("renames and moves notes without replacing anything", async () => {
    const { v, run, list } = await setup();
    await v.write("a.md", "A");
    await v.write("Java/b.md", "B");
    expect((await run("rename_note", { path: "a.md", new_path: "renamed.md" })).status).toBe("applied");
    expect((await run("move_note", { path: "renamed.md", new_path: "Programming/Java/renamed.md" })).status).toBe("applied");
    expect(await readFile(join(v.dir, "Programming/Java/renamed.md"), "utf8")).toBe("A");
    // destination exists: refused, both files intact
    const r = await run("move_note", { path: "Java/b.md", new_path: "Programming/Java/renamed.md" });
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/already exists/) });
    expect(await readFile(join(v.dir, "Java/b.md"), "utf8")).toBe("B");
    expect(await readFile(join(v.dir, "Programming/Java/renamed.md"), "utf8")).toBe("A");
    expect(await list()).toEqual(["Java", "Programming"]);
  });
  it("honours an expected hash on a move", async () => {
    const { v, run } = await setup();
    await v.write("a.md", "now");
    const r = await run("move_note", { path: "a.md", new_path: "b.md", expected_hash: sha256("before") });
    expect(r.status).toBe("conflict");
    expect(await readFile(join(v.dir, "a.md"), "utf8")).toBe("now");
  });
  it("deleting moves the note to the Obsidian trash and never removes it; names do not collide", async () => {
    const { v, run, backups } = await setup();
    await v.write("a.md", "first");
    expect((await run("delete_note", { path: "a.md" })).status).toBe("applied");
    await v.write("a.md", "second");
    expect((await run("delete_note", { path: "a.md" })).status).toBe("applied");
    const trash = await readdir(join(v.dir, ".trash"));
    expect(trash).toHaveLength(2);
    const texts = await Promise.all(trash.map((f) => readFile(join(v.dir, ".trash", f), "utf8")));
    expect(texts.sort()).toEqual(["first", "second"]);
    expect(backups).toEqual(["delete_note", "delete_note"]);
  });
});

describe("folders", () => {
  it("renames and moves a folder with everything in it, including local-only files", async () => {
    const { v, run, list } = await setup();
    await v.write("Java/a.md", NOTE(ID(1), true, "shared"));
    await v.write("Java/private.md", "local only");
    await v.write("Java/img.png", Buffer.from([1]));
    expect((await run("rename_folder", { path: "Java", new_path: "Java OOP" })).status).toBe("applied");
    expect((await run("move_folder", { path: "Java OOP", new_path: "Programming/Java" })).status).toBe("applied");
    expect(await list("Programming/Java")).toEqual(["a.md", "img.png", "private.md"]);
    expect(await readFile(join(v.dir, "Programming/Java/private.md"), "utf8")).toBe("local only");
  });
  it("refuses a destination that exists, or inside itself", async () => {
    const { v, run } = await setup();
    await v.write("A/x.md", "x");
    await v.write("B/y.md", "y");
    expect((await run("move_folder", { path: "A", new_path: "B" })).status).toBe("failed");
    expect((await run("move_folder", { path: "A", new_path: "A/Sub" })).status).toBe("failed");
    expect(await readFile(join(v.dir, "A/x.md"), "utf8")).toBe("x");
    expect(await readFile(join(v.dir, "B/y.md"), "utf8")).toBe("y");
  });
  it("deleting a folder moves all of it to the trash and reports counts by type, not names", async () => {
    const { v, run } = await setup();
    await v.write("Old/a.md", NOTE(ID(1), true, "x"));
    await v.write("Old/secret diary.md", "private");
    await v.write("Old/sub/lec.pdf", "%PDF");
    await v.write("Old/pic.png", "p");
    await v.write("Old/data.csv", "c");
    expect(await folderImpact(v.dir, "Old")).toEqual({ notes: 2, pdfs: 1, images: 1, other: 1, total: 5 });
    const r = await run("delete_folder", { path: "Old" });
    expect(r).toMatchObject({ status: "applied", message: "Folder moved to the Obsidian trash (2 notes, 1 PDFs, 1 images, 1 other files)" });
    expect(r.message).not.toContain("diary");
    expect(await readFile(join(v.dir, ".trash/Old/secret diary.md"), "utf8")).toBe("private");
    await mkdir(join(v.dir, "x"));
  });
});

describe("line diff", () => {
  it("shows added, removed and unchanged lines around the change", () => {
    const d = lineDiff("a\nb\nc\nd\ne\n", "a\nb\nX\nd\ne\n");
    expect(d).toContain("-c");
    expect(d).toContain("+X");
    expect(d).toContain(" b");
  });
  it("copes with very large inputs by cutting the output", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`).join("\n");
    expect(lineDiff(a, b, 3, 1000).length).toBeLessThan(1100);
  });
});

import { patchBody } from "../src/vault/patch.js";
import { chunkMarkdown, renderForUpload } from "../src/vault/links.js";

describe("editing keeps what Claude could not see", () => {
  const viewOf = (body: string) => chunkMarkdown(renderForUpload(body)).map((c) => c.content).join("");

  it("chunks are an exact partition of the synced text, for short and long notes", () => {
    const long = Array.from({ length: 60 }, (_, i) => `## Section ${i}\n${"word ".repeat(300)}\n\n`).join("");
    for (const md of ["# A\nshort\n", "no heading\n\n\ntrailing blanks\n\n\n", long, "x".repeat(9000), "# H\n```\n# not a heading\n```\ntext", "line without final newline"]) {
      expect(chunkMarkdown(md).map((c) => c.content).join(""), md.slice(0, 20)).toBe(md);
      expect(chunkMarkdown(md).every((c) => c.content.length <= 8000 && c.content.length > 0)).toBe(true);
    }
    expect(chunkMarkdown("   \n\n")).toEqual([]);
  });
  it("does not rewrite code, and keeps the line count", () => {
    const md = "Look ![[a.png]]\n```\n![[in-code.png]]\n```\nand `![[inline.png]]` here\n";
    const out = renderForUpload(md);
    expect(out).toContain("[Image attachment: a.png — not synchronized]");
    expect(out).toContain("![[in-code.png]]");
    expect(out).toContain("`![[inline.png]]`");
    expect(out.split("\n")).toHaveLength(md.split("\n").length);
  });
  it("an edit elsewhere in the note leaves embedded images and attachments in place", async () => {
    const { v, run } = await setup();
    const body = "# Java OOP\n\n![[diagram.png]]\n![photo](img/a%20b.jpg)\n\nInheritance only.\n\n![[song.mp3]]\n";
    const text = NOTE(ID(1), true, body);
    await v.write("n.md", text);
    // Claude read the synced view and proposes a new one with an added paragraph
    const proposed = viewOf(body).replace("Inheritance only.", "Inheritance and Polymorphism.\n\nA new paragraph.");
    const r = await run("edit_note", { path: "n.md", new_content: proposed, expected_hash: sha256(text) });
    expect(r.status).toBe("applied");
    const after = await readFile(join(v.dir, "n.md"), "utf8");
    expect(after).toBe(NOTE(ID(1), true, "# Java OOP\n\n![[diagram.png]]\n![photo](img/a%20b.jpg)\n\nInheritance and Polymorphism.\n\nA new paragraph.\n\n![[song.mp3]]\n"));
  });
  it("a long note edited near the end keeps its images too (chunk joins do not leak into the file)", () => {
    const body = "![[top.png]]\n" + Array.from({ length: 40 }, (_, i) => `## S${i}\n${"word ".repeat(250)}\n`).join("") + "last line\n";
    const proposed = viewOf(body).replace("last line", "last line changed");
    const out = patchBody(body, proposed)!;
    expect(out).toBe(body.replace("last line", "last line changed"));
  });
  it("a placeholder kept on a line Claude edited turns back into the original embed", () => {
    const body = "Intro ![[diagram.png]] text\nsecond\n";
    const proposed = "Intro [Image attachment: diagram.png — not synchronized] text, reworded\nsecond\n";
    expect(patchBody(body, proposed)).toBe("Intro ![[diagram.png]] text, reworded\nsecond\n");
  });
  it("removing the placeholder line removes the embed (that is what Claude asked for)", () => {
    expect(patchBody("a\n![[x.png]]\nb\n", "a\nb\n")).toBe("a\nb\n");
  });
  it("keeps Windows line endings", () => {
    const body = "# T\r\n![[x.png]]\r\ntext\r\n";
    expect(patchBody(body, "# T\n[Image attachment: x.png — not synchronized]\ntext\nmore\n")).toBe("# T\r\n![[x.png]]\r\ntext\r\nmore\r\n");
  });
  it("refuses a change it cannot compare safely", () => {
    const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join("\n");
    expect(patchBody(a, b)).toBeNull();
  });
  it("the conflict diff is against what Claude saw, so it never claims an image changed", async () => {
    const { v, run } = await setup();
    const body = "keep ![[x.png]]\nline\n";
    const text = NOTE(ID(1), true, body);
    await v.write("n.md", text);
    await writeFile(join(v.dir, "n.md"), NOTE(ID(1), true, "keep ![[x.png]]\nline EDITED\n"));
    const r = await run("edit_note", { path: "n.md", new_content: "keep [Image attachment: x.png — not synchronized]\nline\nmore\n", expected_hash: sha256(text) });
    expect(r.status).toBe("conflict");
    expect(String(r.conflict!.diff)).not.toContain("![[x.png]]\n+");
    expect(String(r.conflict!.diff)).toContain("-line EDITED");
  });
});
