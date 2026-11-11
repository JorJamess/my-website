import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DocStatus = "synced" | "blocked_secret" | "blocked_revoked" | "failed" | "no_text" | "pending";
export type DocState = { path: string; hash: string; syncVersion: number; status: DocStatus; refsKey: string; message?: string };
export type PdfState = { id: string; size: number; mtimeMs: number; hash: string; syncVersion: number; status: DocStatus; pages?: number; message?: string };
export type ExceptionState = { docId: string; fingerprint: string; contentHash: string };

export type BridgeState = {
  version: 1;
  docs: Record<string, DocState>;
  /** keyed by vault-relative path */
  pdfs: Record<string, PdfState>;
  /** documents the owner revoked in LifeOS, with the grant version at revocation */
  revoked: Record<string, number>;
  /** grant version to upload with, after the owner re-enabled a note */
  grants: Record<string, number>;
  exceptions: ExceptionState[];
  cursors: { rev: string; exc: string };
  /** results of applied commands not yet confirmed by LifeOS; resent instead of running the command again */
  results: Record<string, { status: "applied" | "conflict" | "failed"; message?: string; conflict?: Record<string, unknown> }>;
  /** owner pressed Pause on this Mac (the Menu Bar app or `obsidian-bridge pause`) */
  paused?: boolean;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastError?: string | null;
  /** counts only; helps the owner see how much of the Cloudflare free quota the Bridge uses */
  usage: Record<string, { requests: number; polls: number }>;
};

export const EPOCH = "1970-01-01T00:00:00.000Z";

export const emptyState = (): BridgeState => ({ version: 1, docs: {}, pdfs: {}, revoked: {}, grants: {}, exceptions: [], results: {}, cursors: { rev: EPOCH, exc: EPOCH }, usage: {} });

export async function loadState(file: string): Promise<BridgeState> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as BridgeState;
    if (raw?.version !== 1) return emptyState();
    return { ...emptyState(), ...raw };
  } catch {
    return emptyState();
  }
}

export async function saveState(file: string, s: BridgeState) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export function countUsage(s: BridgeState, kind: "request" | "poll", n = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const u = (s.usage[day] ??= { requests: 0, polls: 0 });
  u.requests += n;
  if (kind === "poll") u.polls += n;
  const days = Object.keys(s.usage).sort();
  for (const d of days.slice(0, Math.max(0, days.length - 14))) delete s.usage[d];
}
