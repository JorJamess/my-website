import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { scanForSecrets, type Finding } from "../shared/secrets.js";
import { MAX_CHUNKS_PER_REQUEST } from "../shared/chunk.js";
import { ApiError, DeviceRevokedError, SyncRefusedError, type SyncApi, type UploadBody } from "../cloudflare/client.js";
import { editFileSafely, walkVault } from "../vault/fs-safe.js";
import { parseNote, setFrontmatterKey, UUID_RE } from "../vault/frontmatter.js";
import { chunkMarkdown } from "../vault/links.js";
import { scanVault, sha256, type ResolvedPdf, type ScannedNote } from "../vault/scan.js";
import { pdfChunks, type PdfExtractor } from "../pdf/extract.js";
import type { BridgeConfig } from "../config/config.js";
import type { Logger } from "../logging.js";
import type { BridgeState } from "./state.js";
import { readFile } from "node:fs/promises";

export const MAX_TOTAL_CHUNKS = 5000;
const MAX_PART_CHARS = 200_000;

export class SyncNotConfirmedError extends Error {
  constructor() {
    super("The initial sync has not been confirmed yet. Review the preview and confirm first.");
  }
}

export type SyncReport = {
  uploaded: number;
  pathUpdates: number;
  removed: number;
  unchanged: number;
  pdfsUploaded: number;
  blocked: { secret: number; revoked: number; duplicateId: number; invalidId: number };
  idsAssigned: number;
  pdfIssues: { no_text: number; too_large: number; failed: number; missing: number };
  errors: string[];
  removalBrake: boolean;
};
const newReport = (): SyncReport => ({ uploaded: 0, pathUpdates: 0, removed: 0, unchanged: 0, pdfsUploaded: 0, blocked: { secret: 0, revoked: 0, duplicateId: 0, invalidId: 0 }, idsAssigned: 0, pdfIssues: { no_text: 0, too_large: 0, failed: 0, missing: 0 }, errors: [], removalBrake: false });

export type SyncContext = {
  cfg: BridgeConfig;
  state: BridgeState;
  api: SyncApi;
  extractPdf: PdfExtractor;
  log: Logger;
  /** called after each document so progress survives a crash */
  persist?: () => Promise<void>;
  /** the owner asked for it explicitly (`sync --allow-removals`): skip the mass-removal safety brake for this run */
  allowAllRemovals?: boolean;
};

/** a failed document or PDF is tried again at most this often */
const RETRY_MS = 60 * 60_000;
const recent = (iso?: string) => !!iso && Date.now() - Date.parse(iso) < RETRY_MS;

const fingerprintsFor = (state: BridgeState, docId: string, hash: string) => new Set(state.exceptions.filter((e) => e.docId === docId && e.contentHash === hash).map((e) => e.fingerprint));
const findingsOf = (text: string, ok: Set<string>): Finding[] => scanForSecrets(text).filter((f) => !ok.has(f.fingerprint));

/** Set `lifeos_sync` in a note's frontmatter (one line, atomically). Used when LifeOS revokes or re-enables a note. */
export async function setSyncFlag(abs: string, value: boolean) {
  return editFileSafely(abs, (t) => setFrontmatterKey(t, "lifeos_sync", value ? "true" : "false"));
}

/** Find a note file by its frontmatter id, whether or not it is currently shared. */
export async function findNoteById(root: string, id: string): Promise<string | null> {
  for (const f of await walkVault(root)) {
    if (!/\.md$/i.test(f.name)) continue;
    const p = parseNote(await readFile(f.abs, "utf8").catch(() => ""));
    if (p.id?.toLowerCase() === id.toLowerCase()) return f.abs;
  }
  return null;
}

/** Give every shared note without an id one. Only the id line is added; the rest of the file is untouched. */
async function assignIds(scan: Awaited<ReturnType<typeof scanVault>>, log: Logger): Promise<number> {
  let n = 0;
  const used = new Set(scan.notes.filter((x) => x.idValid).map((x) => x.id!.toLowerCase()));
  for (const note of scan.notes) {
    if (note.id) continue; // missing only: an invalid id is reported, never overwritten
    let id = randomUUID();
    while (used.has(id)) id = randomUUID();
    used.add(id);
    const done = await editFileSafely(note.abs, (t) => (parseNote(t).id ? t : setFrontmatterKey(t, "id", id)));
    if (done) {
      n++;
      log.info("assigned note id", { path: note.rel });
    }
  }
  return n;
}

async function hashFile(abs: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(abs)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Upload one document in parts of bounded size. Returns the final server status. */
async function uploadParts(ctx: SyncContext, base: Omit<UploadBody, "chunks" | "part" | "total_chunks">, chunks: UploadBody["chunks"], onVersionBump: (v: number) => void) {
  const parts: UploadBody["chunks"][] = [];
  let cur: UploadBody["chunks"] = [];
  let size = 0;
  for (const c of chunks) {
    if (cur.length && (cur.length >= MAX_CHUNKS_PER_REQUEST || size + c.content.length > MAX_PART_CHARS)) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += c.content.length;
  }
  if (cur.length || !parts.length) parts.push(cur);
  let version = base.sync_version;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let last = { status: "syncing" };
      for (let i = 0; i < parts.length; i++) last = await ctx.api.upload({ ...base, sync_version: version, total_chunks: chunks.length, part: i, chunks: parts[i] });
      onVersionBump(version);
      return last.status;
    } catch (e) {
      // the cloud already has a newer version number (e.g. after re-pairing): jump ahead once
      const m = e instanceof ApiError && e.code === "stale_version" ? /version (\d+)/.exec(e.message) : null;
      if (m && attempt === 0) {
        version = Number(m[1]) + 1;
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function syncPdf(ctx: SyncContext, pdf: ResolvedPdf, report: SyncReport): Promise<string | null> {
  const { state, api, cfg } = ctx;
  if (pdf.status === "missing" || pdf.status === "ambiguous" || pdf.status === "unsafe" || !pdf.rel || !pdf.abs) {
    report.pdfIssues.missing++;
    return null;
  }
  const prev = state.pdfs[pdf.rel];
  if (prev && prev.size === pdf.size && prev.mtimeMs === pdf.mtimeMs) {
    // nothing about the file changed: don't hash, extract or report it again
    if (prev.status === "synced" || prev.status === "no_text") return prev.id;
    if (prev.status === "failed" && prev.message === "too large") {
      report.pdfIssues.too_large++;
      return null;
    }
    if (prev.status === "blocked_secret" && (prev.exceptionCount ?? 0) === fingerprintsFor(state, prev.id, prev.hash).size) {
      report.blocked.secret++;
      return null;
    }
    if (prev.status === "failed" && recent(prev.failedAt)) {
      report.pdfIssues.failed++;
      return null;
    }
  }
  const title = pdf.rel.slice(pdf.rel.lastIndexOf("/") + 1);

  if (pdf.status === "too_large") {
    const id = `pdf:${sha256(`${pdf.rel}:${pdf.size}`).slice(0, 32)}`;
    if (!(prev && prev.id === id && prev.status === "failed")) {
      const grant = ctx.state.grants[id] ?? 0;
      const version = (prev?.id === id ? prev.syncVersion : 0) + 1;
      await uploadParts(ctx, { id, kind: "pdf", title, path: pdf.rel, content_hash: sha256(`${pdf.rel}:${pdf.size}`), tags: [], grant_version: grant, sync_version: version, pdf: { state: "too_large", size_bytes: pdf.size, message: `Larger than ${Math.round(cfg.pdfMaxBytes / 1024 / 1024)} MB` } }, [], (v) => (state.pdfs[pdf.rel!] = { id, size: pdf.size, mtimeMs: pdf.mtimeMs, hash: "", syncVersion: v, status: "failed", message: "too large", failedAt: new Date().toISOString() }));
    }
    report.pdfIssues.too_large++;
    return null;
  }

  const hash = await hashFile(pdf.abs);
  const id = `pdf:${hash.slice(0, 32)}`;
  if (prev && prev.id === id && (prev.status === "synced" || prev.status === "no_text")) {
    state.pdfs[pdf.rel] = { ...prev, size: pdf.size, mtimeMs: pdf.mtimeMs };
    return id;
  }
  if (state.revoked[id] !== undefined) return null;
  const res = await ctx.extractPdf(pdf.abs);
  const version = (prev?.id === id ? prev.syncVersion : 0) + 1;
  const grant = state.grants[id] ?? 0;
  const base = { id, kind: "pdf" as const, title, path: pdf.rel, content_hash: hash, tags: [], grant_version: grant, sync_version: version, source_updated_at: new Date(pdf.mtimeMs).toISOString() };

  if (res.state !== "completed") {
    await uploadParts(ctx, { ...base, pdf: { state: res.state, size_bytes: res.sizeBytes, pages: res.pages, message: res.message } }, [], (v) => (state.pdfs[pdf.rel!] = { id, size: pdf.size, mtimeMs: pdf.mtimeMs, hash, syncVersion: v, status: res.state === "no_text" ? "no_text" : "failed", pages: res.pages, message: res.message, failedAt: new Date().toISOString() }));
    report.pdfIssues[res.state === "no_text" ? "no_text" : res.state === "too_large" ? "too_large" : "failed"]++;
    return res.state === "no_text" ? id : null;
  }
  const chunks = pdfChunks(res.content).map((c, index) => ({ index, ...c }));
  if (chunks.length > MAX_TOTAL_CHUNKS) {
    state.pdfs[pdf.rel] = { id, size: pdf.size, mtimeMs: pdf.mtimeMs, hash, syncVersion: prev?.syncVersion ?? 0, status: "failed", message: "Too much text", failedAt: new Date().toISOString() };
    report.pdfIssues.failed++;
    return null;
  }
  const findings = findingsOf(res.content.map((p) => p.text).join("\n"), fingerprintsFor(state, id, hash));
  if (findings.length) {
    await api.reportBlocked({ id, title, path: pdf.rel, content_hash: hash, kind: "pdf", findings });
    state.pdfs[pdf.rel] = { id, size: pdf.size, mtimeMs: pdf.mtimeMs, hash, syncVersion: prev?.syncVersion ?? 0, status: "blocked_secret", exceptionCount: fingerprintsFor(state, id, hash).size };
    report.blocked.secret++;
    return null;
  }
  await uploadParts(ctx, { ...base, pdf: { state: "completed", size_bytes: res.sizeBytes, pages: res.pages } }, chunks, (v) => (state.pdfs[pdf.rel!] = { id, size: pdf.size, mtimeMs: pdf.mtimeMs, hash, syncVersion: v, status: "synced", pages: res.pages }));
  report.pdfsUploaded++;
  return id;
}

/** Note was refused because it was revoked: remember it and switch the flag off in the file so it stops trying. */
async function markRevoked(ctx: SyncContext, note: ScannedNote, grant: number) {
  ctx.state.revoked[note.id!] = grant;
  ctx.state.docs[note.id!] = { path: note.rel, hash: note.hash, syncVersion: ctx.state.docs[note.id!]?.syncVersion ?? 0, status: "blocked_revoked", refsKey: "" };
  await setSyncFlag(note.abs, false);
}

/**
 * One full pass: scan the vault, give new shared notes an id, upload what changed, update moved notes, remove what
 * is gone. Safe to run any number of times; it only sends differences. Never uploads before the initial sync was confirmed.
 */
export async function syncVault(ctx: SyncContext): Promise<SyncReport> {
  const { cfg, state, api, log } = ctx;
  if (!cfg.initialSyncConfirmedAt) throw new SyncNotConfirmedError();
  const report = newReport();
  let scan = await scanVault(cfg.vaultPath, { pdfMaxBytes: cfg.pdfMaxBytes });
  if (scan.notes.some((n) => !n.id)) {
    report.idsAssigned = await assignIds(scan, log);
    scan = await scanVault(cfg.vaultPath, { pdfMaxBytes: cfg.pdfMaxBytes });
  }
  const dupIds = new Set(scan.duplicates.keys());
  const protectedIds = new Set<string>(); // present in the vault, so never removed from the cloud
  const seen = new Set<string>();

  for (const note of scan.notes) {
    if (!note.id || !note.idValid) {
      report.blocked.invalidId++;
      continue;
    }
    const id = note.id; // ids are used exactly as written
    protectedIds.add(id);
    if (dupIds.has(id.toLowerCase())) {
      report.blocked.duplicateId++;
      continue;
    }
    seen.add(id);
    if (state.revoked[id] !== undefined) {
      state.docs[id] = { path: note.rel, hash: note.hash, syncVersion: state.docs[id]?.syncVersion ?? 0, status: "blocked_revoked", refsKey: "" };
      report.blocked.revoked++;
      continue;
    }
    const before = state.docs[id];
    const excCount = fingerprintsFor(state, id, note.hash).size;
    // nothing new to learn about a note that is held back or failed with the same content: don't scan or report it again
    if (before?.hash === note.hash && before.status === "blocked_secret" && (before.exceptionCount ?? 0) === excCount) {
      report.blocked.secret++;
      continue;
    }
    if (before?.hash === note.hash && before.status === "failed" && recent(before.failedAt)) continue;
    try {
      // a note that is already synced and unchanged was scanned when it was uploaded
      const alreadyClean = before?.status === "synced" && before.hash === note.hash;
      const findings = alreadyClean ? [] : findingsOf(`${note.title}\n${note.rendered}`, fingerprintsFor(state, id, note.hash));
      if (findings.length) {
        await api.reportBlocked({ id, title: note.title, path: note.rel, content_hash: note.hash, kind: "note", findings });
        state.docs[id] = { path: note.rel, hash: note.hash, syncVersion: state.docs[id]?.syncVersion ?? 0, status: "blocked_secret", refsKey: "", exceptionCount: excCount };
        report.blocked.secret++;
        continue;
      }
      const pdfIds: string[] = [];
      for (const pdf of note.pdfs) {
        const pid = await syncPdf(ctx, pdf, report);
        if (pid) pdfIds.push(pid);
      }
      const refsKey = [...new Set(pdfIds)].sort().join(",");
      const prev = state.docs[id];
      if (prev && prev.status === "synced" && prev.hash === note.hash && prev.refsKey === refsKey) {
        if (prev.path !== note.rel) {
          await api.updatePath(id, { path: note.rel, title: note.title });
          state.docs[id] = { ...prev, path: note.rel };
          report.pathUpdates++;
        } else report.unchanged++;
        continue;
      }
      const chunks = chunkMarkdown(note.rendered).map((c, index) => ({ index, heading: c.heading, content: c.content }));
      if (chunks.length > MAX_TOTAL_CHUNKS) throw new ApiError(400, "too_long", "The note is too long to sync");
      const version = (prev?.syncVersion ?? 0) + 1;
      await uploadParts(
        ctx,
        { id, kind: "note", title: note.title, path: note.rel, content_hash: note.hash, tags: note.tags, source_updated_at: new Date(note.mtimeMs).toISOString(), grant_version: state.grants[id] ?? 0, sync_version: version, pdf_refs: pdfIds },
        chunks,
        (v) => (state.docs[id] = { path: note.rel, hash: note.hash, syncVersion: v, status: "synced", refsKey }),
      );
      report.uploaded++;
      log.info("synced note", { path: note.rel });
    } catch (e) {
      if (e instanceof DeviceRevokedError) throw e;
      if (e instanceof SyncRefusedError) {
        await markRevoked(ctx, note, state.grants[id] ?? 0);
        report.blocked.revoked++;
      } else if (e instanceof ApiError && e.code === "blocked_secret") {
        state.docs[id] = { path: note.rel, hash: note.hash, syncVersion: state.docs[id]?.syncVersion ?? 0, status: "blocked_secret", refsKey: "", exceptionCount: excCount };
        report.blocked.secret++;
      } else if (e instanceof ApiError && e.transient) {
        throw e; // network, rate limit or quota: stop this pass and retry later with backoff
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        state.docs[id] = { path: note.rel, hash: note.hash, syncVersion: state.docs[id]?.syncVersion ?? 0, status: "failed", refsKey: "", message: msg.slice(0, 200), failedAt: new Date().toISOString() };
        report.errors.push(`${note.rel}: ${msg}`);
        log.warn("note not synced", { path: note.rel, error: msg });
      }
    }
    await ctx.persist?.();
  }

  // notes that are gone, moved to the trash, or no longer shared
  const gone = Object.entries(state.docs).filter(([id, d]) => !protectedIds.has(id) && d.status !== "blocked_revoked" && state.revoked[id] === undefined).map(([id]) => id);
  const total = Object.keys(state.docs).length;
  // notes the owner approved deleting are removed no matter how many; the brake only guards against everything else
  const approved = new Set(state.removalApproved);
  const goneApproved = gone.filter((id) => approved.has(id));
  const goneOther = gone.filter((id) => !approved.has(id));
  state.removalApproved = state.removalApproved.filter((id) => !protectedIds.has(id) && state.docs[id] !== undefined && !goneApproved.includes(id));
  let toRemove = goneApproved;
  if (scan.counts.unreadable > 0 && goneOther.length) {
    report.errors.push("Some files could not be read, so nothing was removed from the cloud this time");
  } else if (!ctx.allowAllRemovals && goneOther.length > Math.max(10, Math.floor(total / 2))) {
    // safety brake: a missing drive or a moved vault must not wipe the cloud copy
    report.removalBrake = true;
    report.errors.push(`${goneOther.length} of ${total} synced notes look gone. Nothing was removed; if you deleted them on purpose run: obsidian-bridge sync --allow-removals`);
    log.warn("removal brake", { gone: goneOther.length, total });
  } else toRemove = gone;
  {
    for (const id of toRemove) {
      try {
        await api.removeDocument(id);
        delete state.docs[id];
        report.removed++;
      } catch (e) {
        if (e instanceof ApiError && e.transient) throw e;
        report.errors.push(`remove ${id}: ${(e as Error).message}`);
      }
    }
  }
  state.lastSyncAt = new Date().toISOString();
  state.lastSuccessAt = state.lastSyncAt;
  state.lastError = report.errors.length ? report.errors[0] : null;
  await ctx.persist?.();
  return report;
}

export { UUID_RE };
