import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { posix } from "node:path";
import { parseNote, UUID_RE } from "./frontmatter.js";
import { basename, findPdfRefs, renderForUpload } from "./links.js";
import { resolveInVault, walkVault, type WalkEntry } from "./fs-safe.js";

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export type PdfStatus = "ok" | "too_large" | "missing" | "ambiguous" | "unsafe";
export type ResolvedPdf = { target: string; rel: string | null; abs: string | null; size: number; mtimeMs: number; status: PdfStatus };

export type ScannedNote = {
  rel: string;
  abs: string;
  title: string;
  id: string | null;
  idValid: boolean;
  hash: string;
  size: number;
  mtimeMs: number;
  tags: string[];
  /** text that would be uploaded (frontmatter removed, attachments replaced by placeholders) */
  rendered: string;
  pdfs: ResolvedPdf[];
};

export type VaultScan = {
  /** only notes with `lifeos_sync: true` */
  notes: ScannedNote[];
  duplicates: Map<string, string[]>;
  counts: { markdown: number; shared: number; localOnly: number; sharedWithoutValidId: number; unreadable: number };
  /** notes with lifeos_sync set to something other than the literal true/false (e.g. "yes") */
  ambiguousFlag: number;
};

export const PDF_MAX_BYTES = 100 * 1024 * 1024;

/** Walk the vault once and classify everything. Local-only notes are only counted, never listed. */
export async function scanVault(root: string, opts: { pdfMaxBytes?: number } = {}): Promise<VaultScan> {
  const maxPdf = opts.pdfMaxBytes ?? PDF_MAX_BYTES;
  const files = await walkVault(root);
  const mdFiles = files.filter((f) => /\.md$/i.test(f.name));
  const pdfByName = new Map<string, WalkEntry[]>();
  const pdfByLowerRel = new Map<string, WalkEntry>();
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name)) continue;
    const k = f.name.toLowerCase();
    pdfByName.set(k, [...(pdfByName.get(k) ?? []), f]);
    pdfByLowerRel.set(f.rel.toLowerCase(), f);
  }

  const notes: ScannedNote[] = [];
  const counts = { markdown: mdFiles.length, shared: 0, localOnly: 0, sharedWithoutValidId: 0, unreadable: 0 };
  let ambiguousFlag = 0;
  for (const f of mdFiles) {
    let text: string;
    try {
      text = await readFile(f.abs, "utf8");
    } catch {
      counts.unreadable++;
      continue;
    }
    const parsed = parseNote(text);
    if (!parsed.sync) {
      counts.localOnly++;
      if (parsed.syncRaw !== null && !/^false$/i.test(parsed.syncRaw)) ambiguousFlag++;
      continue;
    }
    counts.shared++;
    const idValid = !!parsed.id && UUID_RE.test(parsed.id);
    if (!idValid) counts.sharedWithoutValidId++;
    const pdfs: ResolvedPdf[] = [];
    const seenPdf = new Set<string>();
    for (const ref of findPdfRefs(parsed.body)) {
      const r = await resolvePdf(root, f.rel, ref.target, ref.style, pdfByName, pdfByLowerRel, maxPdf);
      const key = r.rel ?? `unresolved:${ref.target}`;
      if (seenPdf.has(key)) continue;
      seenPdf.add(key);
      pdfs.push(r);
    }
    notes.push({
      rel: f.rel,
      abs: f.abs,
      title: basename(f.rel).replace(/\.md$/i, ""),
      id: parsed.id,
      idValid,
      hash: sha256(text),
      size: f.size,
      mtimeMs: f.mtimeMs,
      tags: parsed.tags,
      rendered: renderForUpload(parsed.body),
      pdfs,
    });
  }
  const byId = new Map<string, string[]>();
  for (const n of notes) if (n.id && n.idValid) byId.set(n.id.toLowerCase(), [...(byId.get(n.id.toLowerCase()) ?? []), n.rel]);
  const duplicates = new Map([...byId].filter(([, rels]) => rels.length > 1));
  return { notes, duplicates, counts, ambiguousFlag };
}

async function resolvePdf(root: string, noteRel: string, target: string, style: string, byName: Map<string, WalkEntry[]>, byLowerRel: Map<string, WalkEntry>, maxBytes: number): Promise<ResolvedPdf> {
  const fail = (status: PdfStatus): ResolvedPdf => ({ target, rel: null, abs: null, size: 0, mtimeMs: 0, status });
  const noteDir = posix.dirname(noteRel) === "." ? "" : posix.dirname(noteRel);
  const norm = (p: string) => {
    const n = posix.normalize(p.replace(/^\/+/, ""));
    return n === "." || n.startsWith("../") || n === ".." ? null : n;
  };
  const tries: (string | null)[] = style === "markdown" ? [norm(target.startsWith("/") ? target : posix.join(noteDir, target))] : [norm(target), norm(posix.join(noteDir, target))];
  let hit: WalkEntry | undefined;
  for (const t of tries) {
    if (t === null) continue;
    hit = byLowerRel.get(t.toLowerCase());
    if (hit) break;
  }
  if (!hit && style !== "markdown" && !target.includes("/")) {
    const cands = byName.get(target.toLowerCase()) ?? [];
    if (cands.length === 1) hit = cands[0];
    else if (cands.length > 1) {
      const near = cands.filter((c) => posix.dirname(c.rel) === (noteDir || "."));
      if (near.length === 1) hit = near[0];
      else return fail("ambiguous");
    }
  }
  if (!hit) return tries.every((t) => t === null) ? fail("unsafe") : fail("missing");
  try {
    const safe = await resolveInVault(root, hit.rel, { kind: "pdf", mustExist: true });
    const real = await realpath(safe.abs);
    if (!real.startsWith(safe.rootReal)) return fail("unsafe");
    return { target, rel: safe.rel, abs: safe.abs, size: hit.size, mtimeMs: hit.mtimeMs, status: hit.size > maxBytes ? "too_large" : "ok" };
  } catch {
    return fail("unsafe");
  }
}
