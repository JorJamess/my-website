import "server-only";
import { InputError, ctx } from "../core";
import { logAudit } from "../approvals/repo";
import { scanForSecrets } from "@/lib/obsidian/secrets";
import { MAX_CHUNKS_PER_REQUEST, normalizeText } from "@/lib/obsidian/chunk";
import { validateVaultPath, PathError } from "@/lib/obsidian/paths";
import { getEnv } from "@/lib/server/env";

export type DocStatus = "not_synced" | "pending" | "syncing" | "synced" | "blocked_secret" | "blocked_revoked" | "failed" | "conflict" | "no_text" | "deleted";
export type PdfState = "pending" | "processing" | "completed" | "no_text" | "failed" | "too_large";

export type ObsidianDoc = {
  id: string;
  kind: "note" | "pdf";
  title: string;
  path: string;
  content_hash: string;
  tags: string[];
  status: DocStatus;
  grant_version: number;
  sync_version: number;
  char_count: number;
  source_updated_at: string | null;
  updated_at: string;
  synced_at: string | null;
};

type DocRow = Omit<ObsidianDoc, "tags"> & { tags: string; pending_version: number; expected_chunks: number };
const toDoc = (r: DocRow): ObsidianDoc => {
  const rest: Partial<DocRow> = { ...r };
  delete rest.pending_version;
  delete rest.expected_chunks;
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags) as string[];
  } catch {}
  return { ...(rest as Omit<ObsidianDoc, "tags">), tags };
};

const now = () => new Date().toISOString();

/* ------------------------------ Upload ------------------------------ */

export type UploadInput = {
  id: string;
  kind: "note" | "pdf";
  title: string;
  path: string;
  content_hash: string;
  tags: string[];
  source_updated_at?: string | null;
  grant_version: number;
  /** increases with every new version of this document; older numbers are refused */
  sync_version: number;
  total_chunks: number;
  chunks: { index: number; page?: number | null; heading?: string | null; content: string }[];
  /** for a note: ids of the PDFs it references */
  pdf_refs?: string[];
  /** for a pdf: extraction result */
  pdf?: { state: PdfState; size_bytes?: number | null; pages?: number | null; message?: string | null };
};

export class SyncRejected extends Error {
  constructor(
    public code: "revoked" | "stale_grant" | "stale_version" | "blocked_secret" | "bad_request",
    message: string,
  ) {
    super(message);
  }
}

/** Is a document allowed to upload with this grant version? Revoked documents never are; re-enabled ones need the new version. */
async function checkGrant(db: D1Database, id: string, grant: number) {
  const rev = await db.prepare("SELECT grant_version, state FROM obsidian_revocations WHERE document_id = ?").bind(id).first<{ grant_version: number; state: string }>();
  if (!rev) return;
  if (rev.state === "revoked") throw new SyncRejected("revoked", "This document was revoked in LifeOS. The owner has to re-enable it first.");
  if (grant !== rev.grant_version) throw new SyncRejected("stale_grant", "This upload used an old permission version.");
}

/** SQL condition (inside the same statement) that is true only while the document has not been revoked or given a newer grant. */
const grantOk = (idParam: string, grantParam: string) =>
  `NOT EXISTS (SELECT 1 FROM obsidian_revocations r WHERE r.document_id = ${idParam} AND (r.state = 'revoked' OR r.grant_version <> ${grantParam}))`;

/**
 * A revoke can land while an upload is in flight. The writes above are guarded in SQL, and this re-check after each
 * batch removes anything that slipped in, so a revoked note can never end up searchable again.
 */
async function enforceGrant(db: D1Database, id: string, grant: number) {
  const rev = await db.prepare("SELECT grant_version, state FROM obsidian_revocations WHERE document_id = ?").bind(id).first<{ grant_version: number; state: string }>();
  if (!rev || (rev.state === "reenabled" && rev.grant_version === grant)) return;
  await db.batch([...dropChunks(db, id), db.prepare("UPDATE obsidian_documents SET status = 'blocked_revoked', char_count = 0 WHERE id = ? AND status <> 'blocked_revoked'").bind(id)]);
  throw new SyncRejected(rev.state === "revoked" ? "revoked" : "stale_grant", "This document was revoked in LifeOS while it was uploading. Nothing was kept.");
}

/** SQL that removes search entries and chunks of a document (all versions, or all but `keepVersion`). */
function dropChunks(db: D1Database, id: string, keepVersion?: number) {
  const where = keepVersion === undefined ? "document_id = ?1" : "document_id = ?1 AND sync_version <> ?2";
  const bind = keepVersion === undefined ? [id] : [id, keepVersion];
  return [
    db.prepare(`DELETE FROM obsidian_fts WHERE rowid IN (SELECT rowid FROM obsidian_chunks WHERE ${where})`).bind(...bind),
    db.prepare(`DELETE FROM obsidian_chunks WHERE ${where}`).bind(...bind),
  ];
}

export async function upload(deviceId: string, input: UploadInput & { part?: number }) {
  const { db } = await ctx();
  if (input.chunks.length > MAX_CHUNKS_PER_REQUEST) throw new SyncRejected("bad_request", `At most ${MAX_CHUNKS_PER_REQUEST} chunks per request`);
  if (input.kind === "note" && input.pdf) throw new SyncRejected("bad_request", "A note can't carry PDF details");
  let path: string;
  try {
    path = validateVaultPath(input.path, { kind: input.kind === "note" ? "note" : "pdf" });
  } catch (e) {
    throw new SyncRejected("bad_request", e instanceof PathError ? e.message : "Bad path");
  }
  await checkGrant(db, input.id, input.grant_version);

  const part = input.part ?? 0;
  const existing = await db.prepare("SELECT * FROM obsidian_documents WHERE id = ?").bind(input.id).first<DocRow>();
  if (part === 0 && existing && input.sync_version <= existing.sync_version) {
    throw new SyncRejected("stale_version", `A newer version of this document is already stored (version ${existing.sync_version}).`);
  }
  // later parts only continue an upload that is still the current one (not deleted, not replaced)
  if (part > 0 && (!existing || existing.pending_version !== input.sync_version || existing.pending_version <= existing.sync_version || existing.status === "deleted" || existing.status === "blocked_revoked")) {
    throw new SyncRejected("stale_version", "This upload is no longer the current one.");
  }

  // Defence in depth: the Mac already scanned. If the Worker still finds a secret that the owner has not approved, nothing is stored.
  const text = `${input.title}\n${input.chunks.map((c) => c.content).join("\n")}`;
  const approved = await db
    .prepare("SELECT fingerprint FROM obsidian_findings WHERE document_id = ? AND status = 'excepted' AND content_hash = ?")
    .bind(input.id, input.content_hash)
    .all<{ fingerprint: string }>();
  const ok = new Set(approved.results.map((r) => r.fingerprint));
  const findings = scanForSecrets(text).filter((f) => !ok.has(f.fingerprint));
  if (findings.length) {
    await blockForSecrets(db, deviceId, { ...input, path }, findings);
    throw new SyncRejected("blocked_secret", `Not stored: ${findings.length} possible secret${findings.length === 1 ? "" : "s"} found (${[...new Set(findings.map((f) => f.kind))].join(", ")}).`);
  }

  const t = now();
  const stmts: D1PreparedStatement[] = [];
  if (part === 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO obsidian_documents (id, kind, title, path, content_hash, tags, status, grant_version, pending_version, expected_chunks, char_count, source_updated_at, created_at, updated_at, device_id)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'syncing', ?7, ?8, ?9, 0, ?10, ?11, ?11, ?12 WHERE ${grantOk("?1", "?7")}
           ON CONFLICT(id) DO UPDATE SET kind = ?2, title = ?3, path = ?4, content_hash = ?5, tags = ?6,
             status = CASE WHEN obsidian_documents.status IN ('synced', 'no_text') THEN obsidian_documents.status ELSE 'syncing' END,
             grant_version = ?7, pending_version = ?8, expected_chunks = ?9, source_updated_at = ?10, updated_at = ?11, device_id = ?12
             WHERE obsidian_documents.status <> 'blocked_revoked'`,
        )
        .bind(input.id, input.kind, input.title.slice(0, 300), path, input.content_hash, JSON.stringify(input.tags.slice(0, 50)), input.grant_version, input.sync_version, input.total_chunks, input.source_updated_at ?? null, t, deviceId),
    );
    // staged chunks of an abandoned earlier attempt at a different version
    const keep = [existing?.sync_version ?? 0, input.sync_version];
    stmts.push(
      db.prepare("DELETE FROM obsidian_fts WHERE rowid IN (SELECT rowid FROM obsidian_chunks WHERE document_id = ?1 AND sync_version NOT IN (?2, ?3))").bind(input.id, ...keep),
      db.prepare("DELETE FROM obsidian_chunks WHERE document_id = ?1 AND sync_version NOT IN (?2, ?3)").bind(input.id, ...keep),
    );
  }
  for (const c of input.chunks) {
    const content = normalizeText(c.content);
    const chunkId = `${input.id}:${input.sync_version}:${c.index}`;
    stmts.push(
      // a retried upload replaces the chunk, so its old search entry goes first
      db.prepare("DELETE FROM obsidian_fts WHERE rowid IN (SELECT rowid FROM obsidian_chunks WHERE id = ?)").bind(chunkId),
      db
        .prepare(`INSERT OR REPLACE INTO obsidian_chunks (id, document_id, sync_version, chunk_index, page, heading, content) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${grantOk("?2", "?8")}`)
        .bind(chunkId, input.id, input.sync_version, c.index, c.page ?? null, c.heading ?? null, content, input.grant_version),
      db.prepare("INSERT INTO obsidian_fts (rowid, content) SELECT rowid, content FROM obsidian_chunks WHERE id = ?").bind(chunkId),
    );
  }
  await db.batch(stmts);
  await enforceGrant(db, input.id, input.grant_version);

  // commit once every chunk of this version has arrived
  const staged = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS chars FROM obsidian_chunks WHERE document_id = ? AND sync_version = ?")
    .bind(input.id, input.sync_version)
    .first<{ n: number; chars: number }>();
  const expected = part === 0 ? input.total_chunks : (existing?.expected_chunks ?? 0);
  if ((staged?.n ?? 0) < expected) return { id: input.id, status: "syncing" as const, received: staged?.n ?? 0, expected };

  const finalStatus: DocStatus = input.kind === "pdf" && input.pdf && input.pdf.state !== "completed" ? (input.pdf.state === "no_text" ? "no_text" : "failed") : expected === 0 && input.kind === "pdf" ? "no_text" : "synced";
  const oldRefs = input.kind === "note" && input.pdf_refs ? (await db.prepare("SELECT pdf_id FROM obsidian_pdf_refs WHERE note_id = ?").bind(input.id).all<{ pdf_id: string }>()).results.map((r) => r.pdf_id) : [];
  const commit: D1PreparedStatement[] = [
    ...dropChunks(db, input.id, input.sync_version),
    db
      .prepare(
        `UPDATE obsidian_documents SET sync_version = pending_version, status = ?1, char_count = ?2, synced_at = ?3, updated_at = ?3
         WHERE id = ?4 AND status NOT IN ('blocked_revoked', 'deleted') AND pending_version = ?5 AND ${grantOk("?4", "?6")}`,
      )
      .bind(finalStatus, staged?.chars ?? 0, t, input.id, input.sync_version, input.grant_version),
    // the note is clean now: open findings no longer apply (approved ones stay, but only for the content they were approved for)
    db.prepare("DELETE FROM obsidian_findings WHERE document_id = ?1 AND (status = 'open' OR content_hash <> ?2)").bind(input.id, input.content_hash),
  ];
  if (input.kind === "note" && input.pdf_refs) {
    commit.push(db.prepare("DELETE FROM obsidian_pdf_refs WHERE note_id = ?").bind(input.id));
    for (const pdf of new Set(input.pdf_refs)) commit.push(db.prepare("INSERT OR IGNORE INTO obsidian_pdf_refs (pdf_id, note_id) VALUES (?, ?)").bind(pdf, input.id));
  }
  if (input.kind === "pdf" && input.pdf) {
    commit.push(
      db
        .prepare(
          "INSERT INTO obsidian_pdf_documents (document_id, state, size_bytes, pages, message, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(document_id) DO UPDATE SET state = ?2, size_bytes = ?3, pages = ?4, message = ?5, updated_at = ?6",
        )
        .bind(input.id, input.pdf.state, input.pdf.size_bytes ?? null, input.pdf.pages ?? null, input.pdf.message?.slice(0, 200) ?? null, t),
    );
  }
  await db.batch(commit);
  await enforceGrant(db, input.id, input.grant_version);
  // only PDFs this note stopped referencing can become orphans; a PDF that was just uploaded is never touched
  const kept = new Set(input.pdf_refs ?? []);
  await gcPdfs(oldRefs.filter((id) => !kept.has(id)));
  await touchSyncState(deviceId, "idle", true);
  return { id: input.id, status: finalStatus, received: staged?.n ?? 0, expected };
}

async function blockForSecrets(db: D1Database, deviceId: string, input: UploadInput, findings: ReturnType<typeof scanForSecrets>) {
  const t = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO obsidian_documents (id, kind, title, path, content_hash, tags, status, grant_version, created_at, updated_at, device_id)
         SELECT ?1, ?2, ?3, ?4, ?5, '[]', 'blocked_secret', ?6, ?7, ?7, ?8 WHERE ${grantOk("?1", "?6")}
         ON CONFLICT(id) DO UPDATE SET content_hash = ?5, status = 'blocked_secret', char_count = 0, updated_at = ?7 WHERE obsidian_documents.status <> 'blocked_revoked'`,
      )
      .bind(input.id, input.kind, input.title.slice(0, 300), input.path, input.content_hash, input.grant_version, t, deviceId),
    ...dropChunks(db, input.id),
  ]);
  await replaceFindings(input.id, input.content_hash, findings);
}

/* ------------------------------ Findings ------------------------------ */

type FindingIn = { kind: string; line: number; redacted: string; fingerprint: string };

/** Remember what the scanner found in this exact version of a note (values are never stored). */
export async function replaceFindings(documentId: string, contentHash: string, findings: FindingIn[]) {
  const { db } = await ctx();
  const t = now();
  // owner-approved findings stay while the content is unchanged; everything else is replaced
  const stmts = [db.prepare("DELETE FROM obsidian_findings WHERE document_id = ?1 AND NOT (status = 'excepted' AND content_hash = ?2)").bind(documentId, contentHash)];
  for (const f of findings.slice(0, 50)) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO obsidian_findings (id, document_id, content_hash, kind, line, redacted, fingerprint, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
           WHERE NOT EXISTS (SELECT 1 FROM obsidian_findings WHERE document_id = ?2 AND content_hash = ?3 AND fingerprint = ?7)`,
        )
        .bind(crypto.randomUUID(), documentId, contentHash, f.kind.slice(0, 40), f.line, f.redacted.slice(0, 12), f.fingerprint.slice(0, 80), t),
    );
  }
  await db.batch(stmts);
}

/** The Bridge reports findings for a note it blocked locally (title and path only, never content). */
export async function reportBlocked(deviceId: string, input: { id: string; title: string; path: string; content_hash: string; kind?: "note" | "pdf"; findings: FindingIn[] }) {
  const { db } = await ctx();
  const rev = await db.prepare("SELECT state FROM obsidian_revocations WHERE document_id = ?").bind(input.id).first<{ state: string }>();
  if (rev?.state === "revoked") throw new SyncRejected("revoked", "This document was revoked in LifeOS.");
  let path: string;
  try {
    path = validateVaultPath(input.path, { kind: input.kind === "pdf" ? "pdf" : "note" });
  } catch (e) {
    throw new SyncRejected("bad_request", e instanceof PathError ? e.message : "Bad path");
  }
  const t = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO obsidian_documents (id, kind, title, path, content_hash, tags, status, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, '[]', 'blocked_secret', ?6, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET title = ?3, path = ?4, content_hash = ?5, status = 'blocked_secret', char_count = 0, updated_at = ?6 WHERE obsidian_documents.status <> 'blocked_revoked'`,
      )
      .bind(input.id, input.kind ?? "note", input.title.slice(0, 300), path, input.content_hash, t, deviceId),
    ...dropChunks(db, input.id),
  ]);
  await replaceFindings(input.id, input.content_hash, input.findings);
}

export async function listFindings() {
  const { db } = await ctx();
  const { results } = await db
    .prepare(
      `SELECT f.id, f.document_id, f.kind, f.line, f.redacted, f.status, f.content_hash, d.title, d.path
       FROM obsidian_findings f JOIN obsidian_documents d ON d.id = f.document_id ORDER BY f.created_at DESC LIMIT 200`,
    )
    .all<{ id: string; document_id: string; kind: string; line: number; redacted: string; status: string; content_hash: string; title: string; path: string }>();
  return results;
}

/** The owner approves one finding. It only applies to the exact content it was found in. */
export async function exceptFinding(id: string) {
  const { db } = await ctx();
  const r = await db.prepare("UPDATE obsidian_findings SET status = 'excepted', excepted_at = ? WHERE id = ? AND status = 'open'").bind(now(), id).run();
  if ((r.meta.changes ?? 0) === 0) return false;
  await logAudit({ actor: "you", action: "obsidian_finding_excepted", summary: "Approved one secret-scan finding for a note" });
  return true;
}

export async function exceptionsSince(cursor: string) {
  const { db } = await ctx();
  const { results } = await db
    .prepare("SELECT document_id, fingerprint, content_hash, excepted_at FROM obsidian_findings WHERE status = 'excepted' AND excepted_at > ? ORDER BY excepted_at LIMIT 200")
    .bind(cursor)
    .all<{ document_id: string; fingerprint: string; content_hash: string; excepted_at: string }>();
  return results;
}

/* ------------------------------ Delete / move / revoke ------------------------------ */

const GC_MIN_AGE_MS = 60 * 60_000;

/**
 * Remove PDF text that no shared note references any more. Pass the PDFs a note just stopped referencing; those are
 * the only ones that can have become orphans. Without a list, only PDFs untouched for an hour are considered, so a PDF
 * that was uploaded a moment before the note that references it is never removed by mistake.
 */
export async function gcPdfs(candidates?: string[]) {
  const { db } = await ctx();
  let ids: string[];
  if (candidates) {
    if (!candidates.length) return;
    const marks = candidates.map(() => "?").join(", ");
    const { results } = await db
      .prepare(`SELECT id FROM obsidian_documents WHERE kind = 'pdf' AND status IN ('synced', 'no_text', 'failed') AND id IN (${marks}) AND id NOT IN (SELECT pdf_id FROM obsidian_pdf_refs)`)
      .bind(...candidates)
      .all<{ id: string }>();
    ids = results.map((r) => r.id);
  } else {
    const { results } = await db
      .prepare("SELECT id FROM obsidian_documents WHERE kind = 'pdf' AND status IN ('synced', 'no_text', 'failed') AND updated_at < ? AND id NOT IN (SELECT pdf_id FROM obsidian_pdf_refs)")
      .bind(new Date(Date.now() - GC_MIN_AGE_MS).toISOString())
      .all<{ id: string }>();
    ids = results.map((r) => r.id);
  }
  for (const id of ids) {
    await db.batch([
      ...dropChunks(db, id),
      db.prepare("UPDATE obsidian_documents SET status = 'deleted', char_count = 0, pending_version = sync_version, updated_at = ? WHERE id = ?").bind(now(), id),
      db.prepare("DELETE FROM obsidian_pdf_documents WHERE document_id = ?").bind(id),
    ]);
  }
}

const refsOf = async (db: D1Database, noteId: string) => (await db.prepare("SELECT pdf_id FROM obsidian_pdf_refs WHERE note_id = ?").bind(noteId).all<{ pdf_id: string }>()).results.map((r) => r.pdf_id);

/** A note was deleted or moved to the trash on the Mac: remove its copy. No tombstone, the owner did not revoke anything. */
export async function removeDocument(id: string) {
  const { db } = await ctx();
  const refs = await refsOf(db, id);
  await db.batch([
    ...dropChunks(db, id),
    // pending_version = sync_version also stops any upload of this note that is still arriving
    db.prepare("UPDATE obsidian_documents SET status = 'deleted', char_count = 0, pending_version = sync_version, updated_at = ? WHERE id = ? AND status <> 'blocked_revoked'").bind(now(), id),
    db.prepare("DELETE FROM obsidian_pdf_refs WHERE note_id = ?").bind(id),
    db.prepare("DELETE FROM obsidian_findings WHERE document_id = ?").bind(id),
  ]);
  await gcPdfs(refs);
}

/** The note was renamed or moved on the Mac. Only the stored path and title change. */
export async function updatePath(id: string, path: string, title?: string) {
  const { db } = await ctx();
  try {
    path = validateVaultPath(path, { kind: "note" });
  } catch (e) {
    throw new InputError(e instanceof PathError ? e.message : "Bad path");
  }
  const r = await db
    .prepare("UPDATE obsidian_documents SET path = ?1, title = COALESCE(?2, title), updated_at = ?3 WHERE id = ?4 AND status NOT IN ('blocked_revoked', 'deleted')")
    .bind(path, title?.slice(0, 300) ?? null, now(), id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/**
 * Emergency revoke. Takes effect at once: the note, its PDF text and its search entries are deleted from the current
 * database, a tombstone with a higher grant version is written, and Claude stops seeing it. Cloudflare may keep
 * database history for up to 7 days (Time Travel); that cannot be erased from here.
 */
export async function revokeDocument(id: string, reason = "owner") {
  const { db } = await ctx();
  const doc = await db.prepare("SELECT grant_version FROM obsidian_documents WHERE id = ?").bind(id).first<{ grant_version: number }>();
  const rev = await db.prepare("SELECT grant_version FROM obsidian_revocations WHERE document_id = ?").bind(id).first<{ grant_version: number }>();
  const version = Math.max(doc?.grant_version ?? 0, rev?.grant_version ?? 0) + 1;
  const refs = await refsOf(db, id);
  const t = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO obsidian_revocations (document_id, grant_version, state, reason, revoked_at, changed_at) VALUES (?1, ?2, 'revoked', ?3, ?4, ?4)
         ON CONFLICT(document_id) DO UPDATE SET grant_version = ?2, state = 'revoked', reason = ?3, revoked_at = ?4, reenabled_at = NULL, changed_at = ?4`,
      )
      .bind(id, version, reason.slice(0, 80), t),
    ...dropChunks(db, id),
    db.prepare("UPDATE obsidian_documents SET status = 'blocked_revoked', grant_version = ?1, char_count = 0, tags = '[]', updated_at = ?2 WHERE id = ?3").bind(version, t, id),
    db.prepare("DELETE FROM obsidian_findings WHERE document_id = ?").bind(id),
    db.prepare("DELETE FROM obsidian_pdf_refs WHERE note_id = ?").bind(id),
  ]);
  await gcPdfs(refs);
  await logAudit({ actor: "you", action: "obsidian_revoke", summary: `Revoked cloud access to a note (grant ${version})` });
  return { document_id: id, grant_version: version };
}

/** Owner re-enables a revoked note. The Mac must scan it again and upload with the new grant version. */
export async function reenableDocument(id: string) {
  const { db } = await ctx();
  const rev = await db.prepare("SELECT grant_version, state FROM obsidian_revocations WHERE document_id = ?").bind(id).first<{ grant_version: number; state: string }>();
  if (!rev || rev.state !== "revoked") throw new InputError("This note is not revoked");
  const version = rev.grant_version + 1;
  const t = now();
  await db.batch([
    db.prepare("UPDATE obsidian_revocations SET grant_version = ?1, state = 'reenabled', reenabled_at = ?2, changed_at = ?2 WHERE document_id = ?3").bind(version, t, id),
    db.prepare("UPDATE obsidian_documents SET status = 'pending', grant_version = ?1, updated_at = ?2 WHERE id = ?3").bind(version, t, id),
  ]);
  await logAudit({ actor: "you", action: "obsidian_reenable", summary: `Re-enabled cloud sync for a note (grant ${version})` });
  return { document_id: id, grant_version: version };
}

/** What the Bridge needs to know about permission changes since its last poll. */
export async function revocationsSince(cursor: string) {
  const { db } = await ctx();
  const { results } = await db
    .prepare("SELECT document_id, grant_version, state, changed_at FROM obsidian_revocations WHERE changed_at > ? ORDER BY changed_at LIMIT 200")
    .bind(cursor)
    .all<{ document_id: string; grant_version: number; state: string; changed_at: string }>();
  return results;
}

/* ------------------------------ Restore support ------------------------------ */

/**
 * After the database is restored from a backup: re-apply every tombstone, delete anything revoked that came back,
 * rebuild the search index, and only then allow search again.
 */
export async function reconcileAfterRestore() {
  const { db } = await ctx();
  await setSearchReady(false);
  // If anything below fails, search deliberately stays closed (safer than serving possibly revoked text).
  // Run it again with POST /api/obsidian/reconcile; the Obsidian status shows `search_ready: false` meanwhile.
  const { results } = await db.prepare("SELECT document_id FROM obsidian_revocations WHERE state = 'revoked'").all<{ document_id: string }>();
  const pdfs = new Set<string>();
  for (const { document_id: id } of results) {
    for (const p of await refsOf(db, id)) pdfs.add(p);
    await db.batch([
      ...dropChunks(db, id),
      db.prepare("UPDATE obsidian_documents SET status = 'blocked_revoked', char_count = 0 WHERE id = ? AND status <> 'blocked_revoked'").bind(id),
      db.prepare("DELETE FROM obsidian_pdf_refs WHERE note_id = ?").bind(id),
    ]);
  }
  await gcPdfs([...pdfs]);
  await gcPdfs();
  await rebuildSearchIndex();
  await setSearchReady(true);
}

export async function rebuildSearchIndex() {
  const { db } = await ctx();
  await db.batch([
    db.prepare("DELETE FROM obsidian_fts"),
    db.prepare(
      `INSERT INTO obsidian_fts (rowid, content)
       SELECT c.rowid, c.content FROM obsidian_chunks c JOIN obsidian_documents d ON d.id = c.document_id
       WHERE d.status IN ('synced', 'no_text') AND c.sync_version = d.sync_version`,
    ),
  ]);
}

export async function setSearchReady(ready: boolean) {
  const { db } = await ctx();
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('obsidian_search_ready', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(ready ? "1" : "0").run();
}

export async function searchReady() {
  const { db } = await ctx();
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'obsidian_search_ready'").first<{ value: string }>();
  return r?.value !== "0";
}

/* ------------------------------ Sync state ------------------------------ */

export async function touchSyncState(deviceId: string, status: "idle" | "syncing" | "paused" | "error", success = false, error?: string, details?: Record<string, unknown>) {
  const { db } = await ctx();
  const t = now();
  await db
    .prepare(
      `INSERT INTO obsidian_sync_state (device_id, status, last_success_at, last_error, last_error_at, details, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(device_id) DO UPDATE SET status = ?2, last_success_at = COALESCE(?3, last_success_at),
         last_error = CASE WHEN ?4 IS NULL AND ?3 IS NOT NULL THEN NULL ELSE COALESCE(?4, last_error) END,
         last_error_at = COALESCE(?5, last_error_at), details = CASE WHEN ?8 = 1 THEN ?6 ELSE details END, updated_at = ?7`,
    )
    .bind(deviceId, status, success ? t : null, error?.slice(0, 200) ?? null, error ? t : null, JSON.stringify(details ?? {}), t, details ? 1 : 0)
    .run();
}

/* ------------------------------ Search and read (what Claude may see) ------------------------------ */

export type SearchHit = {
  document_id: string;
  title: string;
  kind: "note" | "pdf";
  path: string;
  tags: string[];
  updated_at: string;
  chunk_id: string;
  chunk_index: number;
  page: number | null;
  heading: string | null;
  excerpt: string;
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const SHORT_SCAN_LIMIT = 5000;

function excerptOf(content: string, terms: string[], radius = 160) {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - radius);
  const end = Math.min(content.length, start + radius * 2 + (terms[0]?.length ?? 0));
  return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

/**
 * Search shared documents only. Words of 3+ characters use the FTS5 trigram index (Thai and Japanese work without spaces).
 * Shorter queries fall back to a LIKE over the 5,000 newest chunks, so they never scan everything.
 */
export async function searchKnowledge(input: { q: string; kind?: "note" | "pdf"; tag?: string; limit?: number; offset?: number; sort?: "relevance" | "date" }) {
  if (!(await searchReady())) throw new InputError("The search index is being rebuilt after a restore. Try again in a minute.");
  const { db } = await ctx();
  const q = normalizeText(input.q).trim();
  if (!q) throw new InputError("Search text is empty");
  if (q.length > 200) throw new InputError("Search text is too long");
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);
  const offset = Math.max(input.offset ?? 0, 0);
  const terms = q.split(/\s+/).filter(Boolean);
  const long = terms.filter((t) => [...t].length >= 3);
  const short = terms.filter((t) => [...t].length < 3);

  const where: string[] = ["d.status IN ('synced', 'no_text')", "c.sync_version = d.sync_version"];
  const bind: unknown[] = [];
  let from: string;
  let order: string;
  if (long.length) {
    from = "obsidian_fts f JOIN obsidian_chunks c ON c.rowid = f.rowid JOIN obsidian_documents d ON d.id = c.document_id";
    where.unshift("obsidian_fts MATCH ?");
    bind.push(long.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND "));
    order = input.sort === "date" ? "d.updated_at DESC" : "rank";
  } else {
    from = `obsidian_chunks c JOIN obsidian_documents d ON d.id = c.document_id`;
    where.unshift(`c.rowid IN (SELECT rowid FROM obsidian_chunks ORDER BY rowid DESC LIMIT ${SHORT_SCAN_LIMIT})`);
    order = "d.updated_at DESC";
  }
  for (const t of short.length && long.length ? short : long.length ? [] : short) {
    where.push("c.content LIKE ? ESCAPE '\\'");
    bind.push(`%${likeEscape(t)}%`);
  }
  if (input.kind) {
    where.push("d.kind = ?");
    bind.push(input.kind);
  }
  if (input.tag) {
    where.push("d.tags LIKE ? ESCAPE '\\'");
    bind.push(`%${likeEscape(JSON.stringify(input.tag))}%`); // the quotes make it an exact tag, not a substring
  }
  const sql = `SELECT d.id AS document_id, d.title, d.kind, d.path, d.tags, d.updated_at, c.id AS chunk_id, c.chunk_index, c.page, c.heading, c.content
    FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`;
  const { results } = await db.prepare(sql).bind(...bind).all<Omit<SearchHit, "excerpt" | "tags"> & { tags: string; content: string }>();

  // one result per document, its best chunk first
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const r of results) {
    if (seen.has(r.document_id)) continue;
    seen.add(r.document_id);
    const { content, tags, ...rest } = r;
    let parsed: string[] = [];
    try {
      parsed = JSON.parse(tags) as string[];
    } catch {}
    hits.push({ ...rest, tags: parsed, excerpt: excerptOf(content, terms) });
  }
  return { total: hits.length, truncated: results.length >= 200, results: hits.slice(offset, offset + limit) };
}

async function activeDoc(id: string) {
  const { db } = await ctx();
  const d = await db.prepare("SELECT * FROM obsidian_documents WHERE id = ? AND status IN ('synced', 'no_text')").bind(id).first<DocRow>();
  return d ? toDoc(d) : null;
}

/** Read a shared note or PDF text in bounded pieces. Returns null if it is not shared (or was revoked). */
export async function readDocument(id: string, opts: { from_chunk?: number; to_chunk?: number; page_from?: number; page_to?: number; max_chars?: number } = {}) {
  if (!(await searchReady())) throw new InputError("The search index is being rebuilt after a restore. Try again in a minute.");
  const doc = await activeDoc(id);
  if (!doc) return null;
  const { db } = await ctx();
  const maxChars = Math.min(Math.max(opts.max_chars ?? 20_000, 500), 40_000);
  const conds = ["document_id = ?1", "sync_version = ?2"];
  const bind: unknown[] = [id, doc.sync_version];
  if (opts.from_chunk !== undefined) {
    conds.push(`chunk_index >= ?${bind.length + 1}`);
    bind.push(opts.from_chunk);
  }
  if (opts.to_chunk !== undefined) {
    conds.push(`chunk_index <= ?${bind.length + 1}`);
    bind.push(opts.to_chunk);
  }
  if (opts.page_from !== undefined) {
    conds.push(`page >= ?${bind.length + 1}`);
    bind.push(opts.page_from);
  }
  if (opts.page_to !== undefined) {
    conds.push(`page <= ?${bind.length + 1}`);
    bind.push(opts.page_to);
  }
  const { results } = await db
    .prepare(`SELECT chunk_index, page, heading, content FROM obsidian_chunks WHERE ${conds.join(" AND ")} ORDER BY chunk_index LIMIT 200`)
    .bind(...bind)
    .all<{ chunk_index: number; page: number | null; heading: string | null; content: string }>();
  const total = await db.prepare("SELECT COUNT(*) AS n FROM obsidian_chunks WHERE document_id = ? AND sync_version = ?").bind(id, doc.sync_version).first<{ n: number }>();
  const out: typeof results = [];
  let used = 0;
  let truncated = false;
  for (const c of results) {
    if (used + c.content.length > maxChars && out.length) {
      truncated = true;
      break;
    }
    out.push(c.content.length > maxChars ? { ...c, content: c.content.slice(0, maxChars) } : c);
    used += Math.min(c.content.length, maxChars);
    if (c.content.length > maxChars) truncated = true;
  }
  const lastIndex = out.length ? out[out.length - 1].chunk_index : null;
  return { document: doc, chunks: out, total_chunks: total?.n ?? 0, truncated, next_chunk: truncated && lastIndex !== null ? lastIndex + 1 : null };
}

/* ------------------------------ Owner views ------------------------------ */

export async function listDocuments(opts: { status?: DocStatus; limit?: number } = {}) {
  const { db } = await ctx();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const stmt = opts.status
    ? db.prepare("SELECT * FROM obsidian_documents WHERE status = ? ORDER BY updated_at DESC LIMIT ?").bind(opts.status, limit)
    : db.prepare("SELECT * FROM obsidian_documents WHERE status <> 'deleted' ORDER BY updated_at DESC LIMIT ?").bind(limit);
  const { results } = await stmt.all<DocRow>();
  return results.map(toDoc);
}

export async function getObsidianStatus() {
  const { db } = await ctx();
  const [devices, byStatus, pdf, open, cmds, sync] = await db.batch([
    db.prepare("SELECT id, name, vault_name, status, paused, sync_requested_at, paired_at, last_seen_at, revoked_at, bridge_version FROM obsidian_devices ORDER BY paired_at DESC"),
    db.prepare("SELECT status, kind, COUNT(*) AS n FROM obsidian_documents GROUP BY status, kind"),
    db.prepare("SELECT state, COUNT(*) AS n FROM obsidian_pdf_documents GROUP BY state"),
    db.prepare("SELECT COUNT(*) AS n FROM obsidian_findings WHERE status = 'open'"),
    db.prepare("SELECT status, COUNT(*) AS n FROM obsidian_commands WHERE status IN ('awaiting_approval', 'approved', 'claimed') GROUP BY status"),
    db.prepare("SELECT * FROM obsidian_sync_state"),
  ]);
  const env = await getEnv();
  return {
    devices: (devices.results as Record<string, unknown>[]).map((d) => ({ ...d, paused: !!d.paused })),
    documents: byStatus.results as { status: string; kind: string; n: number }[],
    pdf_states: pdf.results as { state: string; n: number }[],
    open_findings: (open.results[0] as { n: number }).n,
    commands: cmds.results as { status: string; n: number }[],
    sync: sync.results,
    search_ready: await searchReady(),
    approvals_configured: !!env.OBSIDIAN_PAYLOAD_KEY,
  };
}

/* ------------------------------ Lookups for Claude's tools (shared documents only) ------------------------------ */

export type SharedDoc = { id: string; title: string; path: string; kind: "note" | "pdf"; content_hash: string };
const SHARED = "status IN ('synced', 'no_text')";

/** A shared document at this exact path (case-insensitive, like macOS). Local-only files are never found here. */
export async function sharedDocByPath(path: string): Promise<SharedDoc | null> {
  const { db } = await ctx();
  return db.prepare(`SELECT id, title, path, kind, content_hash FROM obsidian_documents WHERE ${SHARED} AND lower(path) = lower(?) LIMIT 1`).bind(path).first<SharedDoc>();
}

/** Shared documents inside a folder (at any depth). */
export async function sharedDocsUnder(folder: string, limit = 200): Promise<SharedDoc[]> {
  const { db } = await ctx();
  const { results } = await db
    .prepare(`SELECT id, title, path, kind, content_hash FROM obsidian_documents WHERE ${SHARED} AND lower(path) LIKE lower(?) ESCAPE '\\' ORDER BY path LIMIT ?`)
    .bind(`${likeEscape(folder.replace(/\/+$/, ""))}/%`, limit)
    .all<SharedDoc>();
  return results;
}

/** Name of the paired vault, for Obsidian links. */
export async function pairedVaultName(): Promise<string | null> {
  const { db } = await ctx();
  const r = await db.prepare("SELECT vault_name FROM obsidian_devices WHERE status = 'active' ORDER BY paired_at DESC LIMIT 1").first<{ vault_name: string | null }>();
  return r?.vault_name ?? null;
}
