import "server-only";
import { InputError, ctx } from "../core";
import { decide, logAudit } from "../approvals/repo";
import { decryptPayload, encryptPayload } from "@/lib/obsidian/crypto";
import { scanForSecrets } from "@/lib/obsidian/secrets";
import { PathError, validateVaultPath } from "@/lib/obsidian/paths";
import { getEnv } from "@/lib/server/env";
import { proposalsEnabled } from "./documents";

/* Changes Claude can ask for in the vault. They never run in the Worker: after the owner approves, the Mac applies them. */

const HOUR = 3600;
const DAY = 24 * HOUR;
/** How long a proposal may wait for approval, and then how long an approved one may wait for the Mac (counted from approval). */
export const VAULT_OPS = {
  create_note: { ttl: 30 * DAY, label: "Create note", kind: "note" },
  edit_note: { ttl: 7 * DAY, label: "Edit note", kind: "note" },
  rename_note: { ttl: 7 * DAY, label: "Rename note", kind: "note" },
  move_note: { ttl: 7 * DAY, label: "Move note", kind: "note" },
  delete_note: { ttl: 24 * HOUR, label: "Delete note", kind: "note" },
  create_folder: { ttl: 30 * DAY, label: "Create folder", kind: "folder" },
  rename_folder: { ttl: 7 * DAY, label: "Rename folder", kind: "folder" },
  move_folder: { ttl: 7 * DAY, label: "Move folder", kind: "folder" },
  delete_folder: { ttl: 24 * HOUR, label: "Delete folder", kind: "folder" },
} as const;
export type VaultOp = keyof typeof VAULT_OPS;

export const VAULT_TOOLS = new Set<string>(Object.keys(VAULT_OPS).map((o) => `propose_${o}`));
export const isVaultTool = (tool: string) => VAULT_TOOLS.has(tool);
export const opOfTool = (tool: string) => tool.replace(/^propose_/, "") as VaultOp;

export const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;
/** a claimed command with no result after this long is offered again */
const CLAIM_STALE_MS = 10 * 60_000;
const CONFLICT_KEEP_DAYS = 7;
const KEEP_FINISHED_DAYS = 30;

export type CommandStatus = "awaiting_approval" | "approved" | "claimed" | "applied" | "conflict" | "failed" | "expired" | "rejected";

type Row = {
  id: string;
  pending_id: string;
  op: VaultOp;
  status: CommandStatus;
  payload_enc: string | null;
  expected_hash: string | null;
  ttl_seconds: number;
  secret_findings: number;
  attempts: number;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  finished_at: string | null;
  result: string | null;
};

const iso = (ms: number) => new Date(ms).toISOString();

async function key() {
  const k = (await getEnv()).OBSIDIAN_PAYLOAD_KEY;
  if (!k) throw new InputError("Obsidian approvals are not set up yet (the OBSIDIAN_PAYLOAD_KEY secret is missing)");
  return k;
}

/** Strings inside a proposal that will be written into the vault; they are scanned for secrets. */
function writtenText(payload: Record<string, unknown>) {
  return [payload.content, payload.new_content, payload.diff].filter((v): v is string => typeof v === "string").join("\n");
}

function checkPaths(op: VaultOp, payload: Record<string, unknown>) {
  const kind = VAULT_OPS[op].kind;
  const need = (name: string, k: "note" | "folder" = kind) => {
    const v = payload[name];
    if (typeof v !== "string") throw new InputError(`${name} is required`);
    try {
      return validateVaultPath(v, { kind: k });
    } catch (e) {
      throw new InputError(`${name}: ${e instanceof PathError ? e.message : "invalid"}`);
    }
  };
  switch (op) {
    case "create_note":
      need("path");
      if (typeof payload.content !== "string") throw new InputError("content is required");
      break;
    case "edit_note":
      need("path");
      if (typeof payload.new_content !== "string") throw new InputError("new_content is required");
      if (typeof payload.expected_hash !== "string") throw new InputError("expected_hash is required (the hash of the note you read)");
      break;
    case "delete_note":
      need("path");
      break;
    case "rename_note":
    case "move_note":
    case "rename_folder":
    case "move_folder":
      if (need("path") === need("new_path")) throw new InputError("The new path is the same as the old one");
      break;
    case "create_folder":
    case "delete_folder":
      need("path");
      break;
  }
}

/**
 * Claude proposes a vault change. It is checked, size-limited, scanned, encrypted and put in the owner's approval queue.
 * `summary` is the one line the owner sees (paths and counts, never note content).
 */
export async function queueVaultProposal(input: { op: VaultOp; payload: Record<string, unknown>; summary: string }) {
  const spec = VAULT_OPS[input.op];
  if (!spec) throw new InputError("Unknown vault operation");
  if (!(await proposalsEnabled())) throw new InputError("เจ้าของปิดการเสนอแก้ Obsidian อยู่ (เปิดได้ที่ LifeOS → Settings → Obsidian) ตอนนี้ Claude อ่านและค้นได้อย่างเดียว");
  checkPaths(input.op, input.payload);
  const plain = JSON.stringify(input.payload);
  if (new TextEncoder().encode(plain).length > MAX_PAYLOAD_BYTES) throw new InputError("The proposal is larger than 1 MB");
  const findings = scanForSecrets(writtenText(input.payload)).length;
  const k = await key();
  const { db } = await ctx();
  await expireCommands();

  const id = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const t = Date.now();
  const enc = await encryptPayload(k, id, plain);
  const summary = findings ? `${input.summary} (possible secret in the text: it will be created but not synced)` : input.summary;
  await db.batch([
    db
      .prepare("INSERT INTO pending_actions (id, tool, args, summary, risk, status, created_at) VALUES (?, ?, ?, ?, 'vault', 'pending', ?)")
      .bind(pendingId, `propose_${input.op}`, JSON.stringify({ command_id: id, op: input.op }), summary.slice(0, 500), iso(t)),
    db
      .prepare(
        `INSERT INTO obsidian_commands (id, pending_id, op, status, payload_enc, expected_hash, ttl_seconds, secret_findings, created_at, expires_at)
         VALUES (?, ?, ?, 'awaiting_approval', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, pendingId, input.op, enc, typeof input.payload.expected_hash === "string" ? input.payload.expected_hash : null, spec.ttl, findings, iso(t), iso(t + spec.ttl * 1000)),
  ]);
  await logAudit({ actor: "claude", action: `propose_${input.op}`, summary: `Asked to: ${summary}`, pendingId });
  return { pending_id: pendingId, command_id: id, summary, secret_findings: findings };
}

const commandByPending = async (pendingId: string) => (await ctx()).db.prepare("SELECT * FROM obsidian_commands WHERE pending_id = ?").bind(pendingId).first<Row>();

/** The owner said yes. The Mac will pick it up; the expiry clock restarts from this moment. */
export async function approveVaultCommand(pendingId: string) {
  const { db } = await ctx();
  await expireCommands();
  const cmd = await commandByPending(pendingId);
  if (!cmd || cmd.status !== "awaiting_approval") return null;
  const claimed = await decide(pendingId, "approved");
  if (!claimed) return null;
  const t = Date.now();
  await db
    .prepare("UPDATE obsidian_commands SET status = 'approved', approved_at = ?1, expires_at = ?2 WHERE id = ?3 AND status = 'awaiting_approval'")
    .bind(iso(t), iso(t + cmd.ttl_seconds * 1000), cmd.id)
    .run();
  await logAudit({ actor: "you", action: "approve", summary: `Approved: ${claimed.summary} (waiting for the Mac)`, pendingId });
  return claimed;
}

export async function rejectVaultCommand(pendingId: string) {
  const { db } = await ctx();
  await db.prepare("UPDATE obsidian_commands SET status = 'rejected', payload_enc = NULL, finished_at = ? WHERE pending_id = ? AND status = 'awaiting_approval'").bind(iso(Date.now()), pendingId).run();
}

/** Close proposals and approved commands that waited too long, delete their text, and tidy old rows. */
export async function expireCommands() {
  const { db } = await ctx();
  const t = iso(Date.now());
  await db.batch([
    db
      .prepare(
        `UPDATE pending_actions SET status = 'expired', decided_at = ?1, note = 'Expired before it could be applied'
         WHERE status IN ('pending', 'approved') AND id IN (SELECT pending_id FROM obsidian_commands WHERE status IN ('awaiting_approval', 'approved') AND expires_at < ?1)`,
      )
      .bind(t),
    db.prepare("UPDATE obsidian_commands SET status = 'expired', payload_enc = NULL, finished_at = ?1 WHERE status IN ('awaiting_approval', 'approved') AND expires_at < ?1").bind(t),
    // a claimed command that never reported back and ran out of time or tries: the owner's approval row says so too
    db
      .prepare(
        `UPDATE pending_actions SET status = 'failed', decided_at = ?1, note = 'The Mac never reported a result. Check the note in Obsidian before asking again.'
         WHERE status = 'approved' AND id IN (SELECT pending_id FROM obsidian_commands WHERE status = 'claimed' AND (expires_at < ?1 OR (attempts >= ?2 AND claimed_at < ?3)))`,
      )
      .bind(t, MAX_ATTEMPTS, iso(Date.now() - CLAIM_STALE_MS)),
    db
      .prepare("UPDATE obsidian_commands SET status = 'failed', payload_enc = NULL, finished_at = ?1, result = 'The Mac did not report a result' WHERE status = 'claimed' AND (expires_at < ?1 OR (attempts >= ?2 AND claimed_at < ?3))")
      .bind(t, MAX_ATTEMPTS, iso(Date.now() - CLAIM_STALE_MS)),
    db.prepare("UPDATE obsidian_commands SET payload_enc = NULL WHERE status = 'conflict' AND finished_at < ?").bind(iso(Date.now() - CONFLICT_KEEP_DAYS * 86_400_000)),
    db.prepare("DELETE FROM obsidian_commands WHERE status NOT IN ('awaiting_approval', 'approved', 'claimed') AND COALESCE(finished_at, created_at) < ?").bind(iso(Date.now() - KEEP_FINISHED_DAYS * 86_400_000)),
  ]);
}

/* ------------------------- What the owner sees ------------------------- */

/** Full proposal for the approval screen (path, content or diff). Only the signed-in owner can call this. */
export async function previewCommand(pendingId: string) {
  const cmd = await commandByPending(pendingId);
  if (!cmd) return null;
  let payload: unknown = null;
  if (cmd.payload_enc) payload = JSON.parse(await decryptPayload(await key(), cmd.id, cmd.payload_enc));
  const { db } = await ctx();
  const p = await db.prepare("SELECT summary FROM pending_actions WHERE id = ?").bind(pendingId).first<{ summary: string }>();
  return { id: cmd.id, op: cmd.op, summary: p?.summary ?? cmd.op, status: cmd.status, ttl_seconds: cmd.ttl_seconds, expires_at: cmd.expires_at, secret_findings: cmd.secret_findings, result: cmd.result, payload };
}

export async function listCommands(limit = 30) {
  const { db } = await ctx();
  await expireCommands();
  const { results } = await db
    .prepare(
      `SELECT c.id, c.pending_id, c.op, c.status, c.secret_findings, c.attempts, c.created_at, c.expires_at, c.approved_at, c.finished_at, c.result, p.summary
       FROM obsidian_commands c LEFT JOIN pending_actions p ON p.id = c.pending_id ORDER BY c.created_at DESC LIMIT ?`,
    )
    .bind(Math.min(limit, 100))
    .all();
  return results;
}

/* ------------------------- What the Mac sees ------------------------- */

/** Approved commands waiting for the Mac. One indexed read; no text is returned here. */
export async function pollCommands() {
  const { db } = await ctx();
  const t = Date.now();
  const { results } = await db
    // eligibility is decided in SQL, so LIMIT 10 only ever counts commands the Mac can actually take
    .prepare(
      `SELECT id, op, expires_at FROM obsidian_commands
       WHERE status IN ('approved', 'claimed') AND expires_at > ?1 AND (status = 'approved' OR (attempts < ?2 AND claimed_at < ?3))
       ORDER BY approved_at LIMIT 10`,
    )
    .bind(iso(t), MAX_ATTEMPTS, iso(t - CLAIM_STALE_MS))
    .all<{ id: string; op: VaultOp; expires_at: string }>();
  return results;
}

/** How many proposals wait for the owner's yes (the Menu Bar shows this number). One indexed count. */
export async function countAwaitingApproval() {
  const { db } = await ctx();
  const r = await db.prepare("SELECT COUNT(*) AS n FROM obsidian_commands WHERE status = 'awaiting_approval' AND expires_at > ?").bind(iso(Date.now())).first<{ n: number }>();
  return r?.n ?? 0;
}

/** The Mac takes a command. Only one claim can win, and only before the command expires. Returns the decrypted proposal. */
export async function claimCommand(deviceId: string, id: string) {
  const { db } = await ctx();
  const t = Date.now();
  const r = await db
    .prepare(
      `UPDATE obsidian_commands SET status = 'claimed', claimed_at = ?1, claimed_by = ?2, attempts = attempts + 1
       WHERE id = ?3 AND expires_at > ?1 AND attempts < ?4 AND payload_enc IS NOT NULL
         AND (status = 'approved' OR (status = 'claimed' AND claimed_at < ?5))`,
    )
    .bind(iso(t), deviceId, id, MAX_ATTEMPTS, iso(t - CLAIM_STALE_MS))
    .run();
  if ((r.meta.changes ?? 0) === 0) return null;
  const cmd = (await db.prepare("SELECT * FROM obsidian_commands WHERE id = ?").bind(id).first<Row>())!;
  const payload = JSON.parse(await decryptPayload(await key(), cmd.id, cmd.payload_enc!)) as Record<string, unknown>;
  return { id: cmd.id, op: cmd.op, payload, expected_hash: cmd.expected_hash, expires_at: cmd.expires_at, secret_findings: cmd.secret_findings };
}

export type CommandResult = { status: "applied" | "conflict" | "failed"; message?: string; conflict?: Record<string, unknown> };

/** The Mac reports what happened. The text of the proposal is deleted; a conflict keeps only the diff for a few days. */
export async function reportResult(deviceId: string, id: string, res: CommandResult) {
  const { db } = await ctx();
  const cmd = await db.prepare("SELECT * FROM obsidian_commands WHERE id = ?").bind(id).first<Row>();
  if (!cmd || cmd.status !== "claimed" || cmd.claimed_by !== deviceId) return null;
  const message = (res.message ?? "").slice(0, 200);
  let payload: string | null = null;
  if (res.status === "conflict" && res.conflict) {
    const plain = JSON.stringify(res.conflict);
    if (new TextEncoder().encode(plain).length <= MAX_PAYLOAD_BYTES) payload = await encryptPayload(await key(), cmd.id, plain);
  }
  const t = iso(Date.now());
  const pending = await db.prepare("SELECT summary FROM pending_actions WHERE id = ?").bind(cmd.pending_id).first<{ summary: string }>();
  const changed = await db
    .prepare("UPDATE obsidian_commands SET status = ?1, payload_enc = ?2, finished_at = ?3, result = ?4 WHERE id = ?5 AND status = 'claimed'")
    .bind(res.status, payload, t, message || null, id)
    .run();
  if ((changed.meta.changes ?? 0) === 0) return null;
  if (res.status !== "applied") {
    await db.prepare("UPDATE pending_actions SET status = 'failed', note = ?1 WHERE id = ?2").bind(res.status === "conflict" ? "The note changed on the Mac after you approved this. Ask Claude to propose it again." : message || "The Mac could not apply this", cmd.pending_id).run();
  }
  await logAudit({
    actor: "you",
    action: "vault_apply",
    summary: `${res.status === "applied" ? "Applied" : res.status === "conflict" ? "Conflict, not applied" : "Couldn't apply"}: ${pending?.summary ?? cmd.op}`,
    ok: res.status === "applied",
    pendingId: cmd.pending_id,
  });
  return { id, status: res.status };
}
