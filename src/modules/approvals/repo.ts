import "server-only";
import type { ActionRisk, AuditEntry, PendingAction, PendingStatus } from "@/lib/types";
import { ctx } from "../core";

const EXPIRES_DAYS = 7;

type PendingRow = Omit<PendingAction, "args"> & { args: string };
const toPending = (r: PendingRow): PendingAction => ({ ...r, args: JSON.parse(r.args) as Record<string, unknown> });

/** Pending requests older than a week are closed as expired, so an old request can't be approved by mistake. */
async function expireOld() {
  const { db } = await ctx();
  const cutoff = new Date(Date.now() - EXPIRES_DAYS * 86_400_000).toISOString();
  await db.prepare("UPDATE pending_actions SET status = 'expired', decided_at = ?1 WHERE status = 'pending' AND created_at < ?2").bind(new Date().toISOString(), cutoff).run();
}

/** Queue a change for the owner's approval. Asking for the exact same change twice returns the one already waiting. */
export async function queueAction(input: { tool: string; args: Record<string, unknown>; summary: string; risk: ActionRisk }): Promise<PendingAction> {
  const { db } = await ctx();
  await expireOld();
  const args = JSON.stringify(input.args);
  const dup = await db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' AND tool = ? AND args = ?").bind(input.tool, args).first<PendingRow>();
  if (dup) return toPending(dup);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO pending_actions (id, tool, args, summary, risk, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(id, input.tool, args, input.summary, input.risk, now).run();
  return (await getPending(id))!;
}

export async function getPending(id: string): Promise<PendingAction | null> {
  const { db } = await ctx();
  const r = await db.prepare("SELECT * FROM pending_actions WHERE id = ?").bind(id).first<PendingRow>();
  return r ? toPending(r) : null;
}

export async function listPending(): Promise<PendingAction[]> {
  const { db } = await ctx();
  await expireOld();
  const { results } = await db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at ASC").all<PendingRow>();
  return results.map(toPending);
}

export async function countPending(): Promise<number> {
  const { db } = await ctx();
  await expireOld();
  const r = await db.prepare("SELECT COUNT(*) AS n FROM pending_actions WHERE status = 'pending'").first<{ n: number }>();
  return r?.n ?? 0;
}

/** Only a request that is still pending can be decided; returns null when it already was (or doesn't exist). */
export async function decide(id: string, status: Exclude<PendingStatus, "pending" | "expired">, note?: string): Promise<PendingAction | null> {
  const { db } = await ctx();
  const r = await db.prepare("UPDATE pending_actions SET status = ?1, note = ?2, decided_at = ?3 WHERE id = ?4 AND status = 'pending'").bind(status, note ?? null, new Date().toISOString(), id).run();
  if ((r.meta.changes ?? 0) === 0) return null;
  return getPending(id);
}

export async function logAudit(e: { actor: "claude" | "you"; action: string; summary: string; ok?: boolean; pendingId?: string }) {
  const { db } = await ctx();
  await db
    .prepare("INSERT INTO audit_log (id, at, actor, action, summary, ok, pending_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), new Date().toISOString(), e.actor, e.action, e.summary, e.ok === false ? 0 : 1, e.pendingId ?? null)
    .run();
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  const { db } = await ctx();
  await pruneAudit();
  const { results } = await db.prepare("SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?").bind(Math.min(Math.max(limit, 1), 200)).all<Omit<AuditEntry, "ok"> & { ok: number }>();
  return results.map((r) => ({ ...r, ok: !!r.ok }));
}

/** The audit log keeps 90 days. */
export async function pruneAudit() {
  const { db } = await ctx();
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  await db.prepare("DELETE FROM audit_log WHERE at < ?").bind(cutoff).run();
  await db.prepare("DELETE FROM pending_actions WHERE status <> 'pending' AND created_at < ?").bind(cutoff).run();
}
