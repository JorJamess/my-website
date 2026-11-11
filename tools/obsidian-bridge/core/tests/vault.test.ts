import { writeFileSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseNote, replaceBody, setFrontmatterKey } from "../src/vault/frontmatter.js";
import { findPdfRefs, renderForUpload, chunkMarkdown } from "../src/vault/links.js";
import { scanVault } from "../src/vault/scan.js";
import { atomicWrite, editFileSafely, resolveInVault, VaultFsError } from "../src/vault/fs-safe.js";
import { previewInitialSync } from "../src/sync/preview.js";
import { ID, makeVault, NOTE } from "./helpers/vault.js";

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});
const vault = async () => {
  const v = await makeVault();
  cleanups.push(v.cleanup);
  return v;
};

describe("frontmatter", () => {
  it("only the literal true shares a note", () => {
    expect(parseNote("---\nlifeos_sync: true\n---\nx").sync).toBe(true);
    for (const v of ["false", "yes", '"true"', "1", "True1", ""]) expect(parseNote(`---\nlifeos_sync: ${v}\n---\nx`).sync, v).toBe(false);
    expect(parseNote("no frontmatter at all").sync).toBe(false);
    expect(parseNote("---\ntitle: x\n---\nbody").sync).toBe(false);
  });
  it("reads id and tags in the usual shapes", () => {
    const p = parseNote(`---\nid: ${ID(1)}\ntags: [java, "oop"]\n---\nbody`);
    expect(p).toMatchObject({ id: ID(1), tags: ["java", "oop"], body: "body" });
    expect(parseNote("---\ntags:\n  - a\n  - '#b'\nlifeos_sync: true\n---\nx").tags).toEqual(["a", "b"]);
    expect(parseNote("---\ntags: a, b\n---\nx").tags).toEqual(["a", "b"]);
  });
  it("adds or changes one line and leaves the rest byte for byte", () => {
    const text = "---\ntitle: My note\nlifeos_sync: true\nother: [1, 2]\n---\n# Heading\n\nBody  with  spaces\n";
    const out = setFrontmatterKey(text, "id", ID(1));
    expect(out).toBe(`---\ntitle: My note\nlifeos_sync: true\nother: [1, 2]\nid: ${ID(1)}\n---\n# Heading\n\nBody  with  spaces\n`);
    expect(setFrontmatterKey(out, "lifeos_sync", "false")).toBe(out.replace("lifeos_sync: true", "lifeos_sync: false"));
  });
  it("keeps Windows line endings and a BOM", () => {
    const text = "﻿---\r\nlifeos_sync: true\r\n---\r\nBody\r\nmore\r\n";
    const out = setFrontmatterKey(text, "id", ID(2));
    expect(out).toBe(`﻿---\r\nlifeos_sync: true\r\nid: ${ID(2)}\r\n---\r\nBody\r\nmore\r\n`);
    expect(parseNote(out).id).toBe(ID(2));
  });
  it("adds a frontmatter block when there is none, and replaces only the body when asked", () => {
    expect(setFrontmatterKey("Just text\n", "id", "x")).toBe("---\nid: x\n---\nJust text\n");
    expect(replaceBody("---\nid: a\n---\nold", "new")).toBe("---\nid: a\n---\nnew");
  });
});

describe("links and placeholders", () => {
  it("finds PDFs in embeds, wiki links and markdown links, but not inside code or on the web", () => {
    const md = "![[database.pdf]]\nsee [[notes/lecture 2.pdf#page=3|slides]]\n[Open PDF](./files/a%20b.pdf)\n`[[ignored.pdf]]`\n```\n[x](in-code.pdf)\n```\n[web](https://x.test/a.pdf)\n[[Other note]]";
    expect(findPdfRefs(md)).toEqual([
      { target: "database.pdf", style: "embed" },
      { target: "notes/lecture 2.pdf", style: "wiki" },
      { target: "./files/a b.pdf", style: "markdown" },
    ]);
  });
  it("replaces images and attachments with a placeholder and leaves other links alone", () => {
    const out = renderForUpload("Diagram: ![[java-architecture.png]]\n![alt](./img/a%20b.JPG)\n![[song.mp3]]\n![web](https://x.test/p.png)\nSee [[Personal Thoughts]] and ![[x.pdf]]");
    expect(out).toContain("[Image attachment: java-architecture.png — not synchronized]");
    expect(out).toContain("[Image attachment: a b.JPG — not synchronized]");
    expect(out).toContain("[Attachment attachment: song.mp3 — not synchronized]");
    expect(out).toContain("![web](https://x.test/p.png)");
    expect(out).toContain("See [[Personal Thoughts]] and ![[x.pdf]]");
    expect(out).not.toMatch(/!\[\[java-architecture/);
  });
  it("chunks keep the nearest heading and stay bounded", () => {
    const md = "# A\n" + "a".repeat(100) + "\n## B\n" + "b".repeat(5000) + "\n## C\nshort";
    const c = chunkMarkdown(md);
    expect(c.every((x) => x.content.length <= 4000)).toBe(true);
    expect(c[0].heading).toBe("A");
    expect(c.find((x) => x.content.includes("bbbb"))!.heading).toBe("B");
    expect(c[c.length - 1]).toMatchObject({ heading: "C" });
  });
});

describe("scanning the vault", () => {
  it("counts local-only notes but never lists them, and skips hidden folders", async () => {
    const v = await vault();
    await v.write("Shared/a.md", NOTE(ID(1), true, "shared body"));
    await v.write("Private/secret thoughts.md", "no flag here");
    await v.write("Private/explicit.md", NOTE(ID(2), false, "explicitly local"));
    await v.write("Private/maybe.md", NOTE(ID(3), "yes", "ambiguous"));
    await v.write(".obsidian/plugins/x.md", NOTE(ID(4), true, "inside .obsidian"));
    await v.write(".trash/old.md", NOTE(ID(5), true, "in trash"));
    const scan = await scanVault(v.dir);
    expect(scan.notes.map((n) => n.rel)).toEqual(["Shared/a.md"]);
    expect(scan.counts).toMatchObject({ markdown: 4, shared: 1, localOnly: 3 });
    expect(scan.ambiguousFlag).toBe(1);
    expect(JSON.stringify(scan.counts)).not.toContain("secret thoughts");
  });
  it("a note outside a folder is shared only by its own flag, not its folder", async () => {
    const v = await vault();
    await v.write("Programming/Java/a.md", NOTE(ID(1), true, "x"));
    await v.write("Programming/Java/b.md", "no flag");
    expect((await scanVault(v.dir)).notes).toHaveLength(1);
  });
  it("detects missing, invalid and duplicate ids", async () => {
    const v = await vault();
    await v.write("a.md", NOTE(null, true, "no id"));
    await v.write("b.md", NOTE("not-a-uuid", true, "bad id"));
    await v.write("c.md", NOTE(ID(7), true, "one"));
    await v.write("d.md", NOTE(ID(7), true, "two"));
    const scan = await scanVault(v.dir);
    expect(scan.counts.sharedWithoutValidId).toBe(2);
    expect([...scan.duplicates.keys()]).toEqual([ID(7)]);
    expect(scan.duplicates.get(ID(7))!.sort()).toEqual(["c.md", "d.md"]);
  });
  it("resolves PDFs from all three forms and de-duplicates the same file", async () => {
    const v = await vault();
    await v.write("Uni/DB/lecture.pdf", "%PDF-1.4 fake");
    await v.write("Uni/Other/lecture.pdf", "%PDF-1.4 other");
    await v.write("Files/database.pdf", "%PDF-1.4 fake");
    await v.write("Uni/DB/n.md", NOTE(ID(1), true, "![[database.pdf]]\n[[Files/database.pdf]]\n[Open](../DB/lecture.pdf)\n[[lecture.pdf]]\n[[missing.pdf]]"));
    const scan = await scanVault(v.dir);
    const pdfs = scan.notes[0].pdfs;
    expect(pdfs.filter((p) => p.status === "ok").map((p) => p.rel).sort()).toEqual(["Files/database.pdf", "Uni/DB/lecture.pdf"]);
    expect(pdfs.filter((p) => p.status === "missing")).toHaveLength(1);
  });
  it("refuses PDFs that escape the vault or sit behind a symlink", async () => {
    const v = await vault();
    const outside = await vault();
    await outside.write("evil.pdf", "%PDF-1.4 outside");
    await symlink(outside.dir, join(v.dir, "link"));
    await v.write("n.md", NOTE(ID(1), true, "[x](../../etc/passwd.pdf)\n[[link/evil.pdf]]\n[y](link/evil.pdf)"));
    const scan = await scanVault(v.dir);
    expect(scan.notes[0].pdfs.every((p) => p.status !== "ok")).toBe(true);
    expect(scan.notes[0].pdfs.every((p) => p.abs === null)).toBe(true);
  });
  it("flags PDFs over the size limit without reading them", async () => {
    const v = await vault();
    await v.write("big.pdf", Buffer.alloc(3000));
    await v.write("n.md", NOTE(ID(1), true, "![[big.pdf]]"));
    expect((await scanVault(v.dir, { pdfMaxBytes: 2048 })).notes[0].pdfs[0].status).toBe("too_large");
  });
  it("the initial preview is numbers only", async () => {
    const v = await vault();
    await v.write("a.md", NOTE(ID(1), true, "ok text"));
    await v.write("b.md", NOTE(null, true, 'password = "hunter2hunter2"'));
    await v.write("c.md", "local only name that must not appear");
    await v.write("p.pdf", "%PDF-1.4 x");
    await v.write("d.md", NOTE(ID(2), true, "![[p.pdf]] ![[gone.pdf]]"));
    const p = await previewInitialSync(v.dir);
    expect(p).toMatchObject({ markdownFiles: 4, eligibleNotes: 3, notesWithId: 2, notesNeedingId: 1, blockedBySecretScan: 1, referencedPdfs: 1, pdfsNotFound: 1 });
    expect(JSON.stringify(p)).not.toContain("local only name");
  });
});

describe("safe file access", () => {
  it("rejects traversal, hidden folders and symlink escapes", async () => {
    const v = await vault();
    const outside = await vault();
    await symlink(outside.dir, join(v.dir, "link"));
    for (const bad of ["../x.md", ".obsidian/app.json", "link/x.md", "a/../../x.md", "/etc/x.md"]) {
      await expect(resolveInVault(v.dir, bad, { kind: "note" }), bad).rejects.toThrow(VaultFsError);
    }
    const ok = await resolveInVault(v.dir, "New/Folder/note.md", { kind: "note" });
    expect(ok.abs.startsWith(v.dir)).toBe(true);
  });
  it("atomic exclusive write never overwrites", async () => {
    const v = await vault();
    const target = join(v.dir, "n.md");
    await atomicWrite(target, "first", { exclusive: true });
    await expect(atomicWrite(target, "second", { exclusive: true })).rejects.toThrow(/already exists/);
    expect(await readFile(target, "utf8")).toBe("first");
    await atomicWrite(target, "third");
    expect(await readFile(target, "utf8")).toBe("third");
  });
  it("editFileSafely backs off if the file changed while it worked", async () => {
    const v = await vault();
    const f = join(v.dir, "n.md");
    await writeFile(f, "one");
    let first = true;
    const out = await editFileSafely(f, (t) => {
      if (first) {
        first = false;
        writeFileSync(f, "changed by Obsidian"); // someone saves in the meantime
        return "mine";
      }
      return t + "+edit";
    });
    expect(await readFile(f, "utf8")).toBe("changed by Obsidian+edit");
    expect(out?.after).toBe("changed by Obsidian+edit");
    await mkdir(join(v.dir, "x"));
  });
});
