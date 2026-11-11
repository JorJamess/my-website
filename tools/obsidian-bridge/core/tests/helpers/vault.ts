import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, type SyncApi, type UploadBody } from "../../src/cloudflare/client.js";
import type { BridgeConfig } from "../../src/config/config.js";
import { emptyState } from "../../src/sync/state.js";
import { silentLogger } from "../../src/logging.js";
import { createPdfExtractor } from "../../src/pdf/extract.js";
import type { SyncContext } from "../../src/sync/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
export const NATIVE = join(here, "../../native/bin");
export const hasNative = process.platform === "darwin" && existsSync(join(NATIVE, "pdf-text")) && existsSync(join(NATIVE, "make-fixture"));

/** A throwaway vault in the temp folder. Never the real one. */
export async function makeVault() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "obs-vault-")));
  await mkdir(join(dir, ".obsidian"));
  await writeFile(join(dir, ".obsidian", "app.json"), "{}");
  const write = async (rel: string, text: string | Uint8Array) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text);
  };
  return { dir, write, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function makePdf(out: string, font: string, ...pages: string[]) {
  execFileSync(join(NATIVE, "make-fixture"), [out, font, ...pages]);
}

export const NOTE = (id: string | null, sync: boolean | string, body: string, extra = "") => `---\n${id ? `id: ${id}\n` : ""}lifeos_sync: ${sync}\n${extra}---\n${body}`;

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type Stored = { upload: UploadBody; chunks: UploadBody["chunks"] };

/** In-memory stand-in for LifeOS that records what the Bridge sent. */
export class FakeApi implements SyncApi {
  docs = new Map<string, { body: UploadBody; chunks: UploadBody["chunks"]; path: string }>();
  removed: string[] = [];
  blocked: { id: string; kind?: string; findings: number }[] = [];
  calls: string[] = [];
  refuse = new Set<string>();
  failWith: ApiError | null = null;
  async upload(body: UploadBody) {
    this.calls.push(`upload:${body.id}:${body.part}`);
    if (this.failWith) throw this.failWith;
    if (this.refuse.has(body.id)) throw new (await import("../../src/cloudflare/client.js")).SyncRefusedError(403, "revoked", "revoked");
    const cur = this.docs.get(body.id);
    if (body.part === 0 && cur && body.sync_version <= cur.body.sync_version) throw new ApiError(409, "stale_version", `A newer version of this document is already stored (version ${cur.body.sync_version}).`);
    const prev = body.part === 0 ? [] : (cur?.chunks ?? []);
    this.docs.set(body.id, { body, chunks: [...prev, ...body.chunks], path: body.path });
    return { id: body.id, status: "synced", received: 0, expected: 0 };
  }
  async removeDocument(id: string) {
    this.calls.push(`remove:${id}`);
    if (this.failWith) throw this.failWith;
    this.removed.push(id);
    this.docs.delete(id);
    return { ok: true };
  }
  async updatePath(id: string, b: { path: string; title?: string }) {
    this.calls.push(`path:${id}`);
    const d = this.docs.get(id);
    if (d) d.path = b.path;
    return { ok: true };
  }
  async reportBlocked(b: { id: string; kind?: string; findings: unknown[] }) {
    this.calls.push(`blocked:${b.id}`);
    this.blocked.push({ id: b.id, kind: b.kind, findings: b.findings.length });
    return { ok: true };
  }
  text(id: string) {
    return (this.docs.get(id)?.chunks ?? []).map((c) => c.content).join("\n");
  }
}

export function makeCtx(vaultPath: string, api: SyncApi, over: Partial<BridgeConfig> = {}): SyncContext {
  const cfg: BridgeConfig = { version: 1, lifeosUrl: "https://example.test", vaultPath, vaultName: "Test", deviceName: "Test Mac", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 100 * 1024 * 1024, initialSyncConfirmedAt: new Date().toISOString(), ...over };
  return { cfg, state: emptyState(), api, extractPdf: createPdfExtractor(join(NATIVE, "pdf-text")), log: silentLogger };
}
