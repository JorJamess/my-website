import { watch, type FSWatcher } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { callService } from "./ipc.js";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { ApiError, BridgeClient, DeviceRevokedError, type FetchLike, type PollResult } from "../cloudflare/client.js";
import { executeCommand, noBackupConfigured, type SafetyBackup } from "../approvals/executor.js";
import { saveConfig, type BridgeConfig } from "../config/config.js";
import type { Logger } from "../logging.js";
import type { PdfExtractor } from "../pdf/extract.js";
import type { BackupManager, DestResult } from "../backup/manager.js";
import type { CredentialStore } from "../security/keychain.js";
import { findNoteById, setSyncFlag, syncVault, SyncNotConfirmedError, type SyncReport } from "../sync/engine.js";
import { previewInitialSync } from "../sync/preview.js";
import { countUsage, saveState, type BackupStatus, type BridgeState } from "../sync/state.js";

/** another Bridge is already running for this user: starting a second one would make them overwrite each other */
export class AlreadyRunningError extends Error {
  constructor() {
    super("The Bridge is already running.");
  }
}
/** nothing to run yet: this Mac has no device token */
export class NotPairedError extends Error {
  constructor() {
    super("This Mac is not paired. Run: obsidian-bridge pair");
  }
}

/** when a process started, as ps prints it ("" if unknown); a reused process id has a different start time */
export const processStartTime = (pid: number): Promise<string> =>
  new Promise((res) => execFile("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 3000 }, (e, out) => res(e ? "" : String(out).trim())));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export type ServiceOptions = {
  /** a file holding this service's process id, so a second instance can tell it is not alone */
  pidFile?: string;
  cfg: BridgeConfig;
  configFile: string;
  stateFile: string;
  socketPath: string;
  state: BridgeState;
  credentials: CredentialStore;
  extractPdf: PdfExtractor;
  log: Logger;
  fetch?: FetchLike;
  /** the backup system; without it, edits, moves and deletes stay refused */
  backups?: BackupManager;
  safetyBackup?: SafetyBackup;
  /** test hooks */
  backupCheckMs?: number;
  debounceMs?: number;
  reconcileEveryMs?: number;
  wakeCheckMs?: number;
};

export type ServiceStatus = {
  running: true;
  online: boolean;
  paused: boolean;
  pausedByOwnerInLifeos: boolean;
  initialSyncConfirmed: boolean;
  syncing: boolean;
  deviceRevoked: boolean;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastError?: string | null;
  pendingCommands: number;
  /** proposals waiting for the owner's approval in LifeOS (as of the last poll) */
  awaitingApproval: number;
  docs: Record<string, number>;
  pdfs: Record<string, number>;
  usageToday: { requests: number; polls: number };
  pollSeconds: number;
  backoffSeconds: number;
  backup: { configured: boolean; local?: BackupStatus; external?: BackupStatus };
};

const DEFAULT_BACKOFF_MAX = 300;

/** The long-running part of the Bridge: polls LifeOS, syncs the vault, applies approved changes, answers the Menu Bar app and CLI. */
export class BridgeService {
  private client!: BridgeClient;
  private watcher: FSWatcher | null = null;
  private server: Server | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private lastTick = Date.now();
  private stopped = true;
  private online = true;
  private fails = 0;
  private syncing = false;
  private queue: Promise<unknown> = Promise.resolve();
  private ownerPaused = false;
  private syncWanted = false;
  private deviceRevoked = false;
  private pendingCommands = 0;
  private awaitingApproval = 0;
  private lastHeartbeat = 0;
  private lastBeatStatus = "";
  private syncRequestSeen = false;
  private backupTimer: NodeJS.Timeout | null = null;

  constructor(private o: ServiceOptions) {}

  private get cfg() {
    return this.o.cfg;
  }
  private get state() {
    return this.o.state;
  }
  private get log() {
    return this.o.log;
  }

  /** run one thing at a time: a sync and a command must not edit the vault together */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private save() {
    return saveState(this.o.stateFile, this.state).catch((e) => this.log.error("could not save state", { error: (e as Error).message }));
  }

  async start() {
    if (!this.stopped) return;
    await this.claimInstance();
    this.stopped = false;
    const token = this.cfg.deviceId ? await this.o.credentials.get(this.cfg.deviceId) : null;
    if (!token) {
      await this.releaseInstance();
      throw new NotPairedError();
    }
    this.client = new BridgeClient(this.cfg.lifeosUrl, token, this.o.fetch, () => countUsage(this.state, "request"));
    await this.listen();
    this.startWatcher();
    this.reconcileTimer = setInterval(() => this.requestSync("periodic"), this.o.reconcileEveryMs ?? 10 * 60_000);
    // a long gap between ticks means the Mac was asleep: catch up straight away
    this.lastTick = Date.now();
    this.wakeTimer = setInterval(() => {
      const gap = Date.now() - this.lastTick;
      this.lastTick = Date.now();
      if (gap > 60_000) {
        this.log.info("woke from sleep", { gapSeconds: Math.round(gap / 1000) });
        this.fails = 0;
        this.schedulePoll(0);
        this.requestSync("wake");
        void this.checkBackups();
      }
    }, this.o.wakeCheckMs ?? 5000);
    // scheduled backups: check every minute whether a cycle is due (also catches up after sleep or a missed night)
    if (this.o.backups) {
      this.backupTimer = setInterval(() => void this.checkBackups(), this.o.backupCheckMs ?? 60_000);
      void this.checkBackups();
    }
    this.requestSync("startup");
    this.schedulePoll(0);
    this.log.info("bridge started");
  }

  async stop() {
    this.stopped = true;
    for (const t of [this.pollTimer, this.debounce, this.reconcileTimer, this.wakeTimer, this.backupTimer]) if (t) clearTimeout(t);
    clearInterval(this.backupTimer ?? undefined);
    clearInterval(this.reconcileTimer ?? undefined);
    clearInterval(this.wakeTimer ?? undefined);
    this.watcher?.close();
    this.watcher = null;
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    await this.queue.catch(() => {});
    await this.save();
    await rm(this.o.socketPath, { force: true });
    await this.releaseInstance();
    this.log.info("bridge stopped");
  }

  /** Refuse to start if another Bridge is alive (it answers on the socket, or its process id file points at a live process). */
  private async claimInstance() {
    const live = await callService(this.o.socketPath, "status", {}, 1500);
    if (live) throw new AlreadyRunningError();
    const f = this.o.pidFile;
    if (!f) return;
    await mkdir(dirname(f), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(f, `${process.pid}\n${await processStartTime(process.pid)}`, { flag: "wx", mode: 0o600 });
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const [pidText, ...startParts] = (await readFile(f, "utf8").catch(() => "")).split("\n");
        const other = Number(pidText);
        // alive AND the same process that wrote the file: after a reboot the number may belong to something unrelated
        if (other && other !== process.pid && alive(other)) {
          const recorded = startParts.join("\n").trim();
          if (recorded && (await processStartTime(other)) === recorded) throw new AlreadyRunningError();
        }
        await rm(f, { force: true }); // left behind by a process that is gone
      }
    }
    throw new AlreadyRunningError();
  }

  private async releaseInstance() {
    const f = this.o.pidFile;
    if (f && Number((await readFile(f, "utf8").catch(() => "")).split("\n")[0]) === process.pid) await rm(f, { force: true });
  }

  /* ------------------------------- polling ------------------------------- */

  private schedulePoll(ms: number) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.pollOnce(), ms);
  }

  /** the delay before the next poll: normal interval, or bounded exponential backoff with a little jitter while offline */
  nextDelayMs() {
    if (this.fails === 0) return this.cfg.pollSeconds * 1000;
    const secs = Math.min(DEFAULT_BACKOFF_MAX, this.cfg.pollSeconds * 2 ** Math.min(this.fails, 8));
    return Math.round(secs * 1000 * (0.9 + Math.random() * 0.2));
  }

  async pollOnce() {
    if (this.stopped || this.deviceRevoked) return;
    try {
      await this.flushResults();
      const res = await this.client.poll(this.state.cursors);
      countUsage(this.state, "poll");
      if (!this.online || this.fails) this.log.info("back online");
      this.online = true;
      this.fails = 0;
      this.ownerPaused = res.paused;
      await this.applyPermissionChanges(res);
      this.state.cursors = { rev: res.cursor, exc: res.cursor };
      this.pendingCommands = res.commands.length;
      this.awaitingApproval = res.awaiting_approval ?? 0;
      if (res.sync_requested) {
        this.syncRequestSeen = true;
        this.requestSync("owner");
      }
      if (res.commands.length && !this.isPaused()) await this.exclusive(() => this.runCommands(res));
      await this.heartbeat(false);
      await this.save();
    } catch (e) {
      await this.handlePollError(e);
    }
    this.schedulePoll(this.nextDelayMs());
  }

  private async handlePollError(e: unknown) {
    if (e instanceof DeviceRevokedError) {
      this.deviceRevoked = true;
      this.state.lastError = e.message;
      this.log.error("this Mac was revoked in LifeOS; syncing stopped");
      await this.save();
      return;
    }
    const transient = e instanceof ApiError ? e.transient : true;
    this.fails++;
    this.online = !(e instanceof ApiError && e.status === 0);
    this.state.lastError = (e as Error).message;
    this.log.warn("poll failed", { error: (e as Error).message, attempt: this.fails });
    if (e instanceof ApiError && e.retryAfterSeconds) this.fails = Math.max(this.fails, Math.ceil(Math.log2(e.retryAfterSeconds / this.cfg.pollSeconds)));
    if (!transient) this.log.error("poll rejected", { error: (e as Error).message });
  }

  /** Apply revocations and re-enables from LifeOS, and remember owner-approved secret findings. Safe to repeat. */
  private async applyPermissionChanges(res: PollResult) {
    for (const r of res.revocations) {
      if (r.state === "revoked") {
        if (this.state.revoked[r.document_id] === r.grant_version) continue;
        this.state.revoked[r.document_id] = r.grant_version;
        const d = this.state.docs[r.document_id];
        if (d) d.status = "blocked_revoked";
        this.resetPdfState(r.document_id, true);
        const file = await findNoteById(this.cfg.vaultPath, r.document_id);
        if (file) await setSyncFlag(file, false);
        this.log.info("applied revoke from LifeOS", { document: r.document_id });
      } else {
        if (this.state.grants[r.document_id] === r.grant_version && this.state.revoked[r.document_id] === undefined) continue;
        delete this.state.revoked[r.document_id];
        this.state.grants[r.document_id] = r.grant_version;
        this.resetPdfState(r.document_id, false);
        const file = await findNoteById(this.cfg.vaultPath, r.document_id);
        // the owner re-enabled it in LifeOS: switch the flag back on; the next sync scans it fresh before anything is uploaded
        if (file) await setSyncFlag(file, true);
        delete this.state.docs[r.document_id];
        this.syncWanted = true;
        this.log.info("applied re-enable from LifeOS", { document: r.document_id });
      }
    }
    let newException = false;
    for (const e of res.exceptions) {
      if (!this.state.exceptions.some((x) => x.docId === e.document_id && x.fingerprint === e.fingerprint && x.contentHash === e.content_hash)) {
        this.state.exceptions.push({ docId: e.document_id, fingerprint: e.fingerprint, contentHash: e.content_hash });
        newException = true;
      }
    }
    if (newException || this.syncWanted) this.requestSync("permission change");
  }

  private async flushResults() {
    for (const [id, result] of Object.entries(this.state.results)) {
      try {
        await this.client.reportResult(id, result);
        delete this.state.results[id];
      } catch (e) {
        if (e instanceof ApiError && !e.transient) delete this.state.results[id]; // LifeOS no longer wants it (expired or taken)
        else throw e;
      }
    }
  }

  private async runCommands(res: PollResult) {
    for (const c of res.commands) {
      const known = this.state.results[c.id];
      if (known) continue; // already applied, result is waiting to be delivered
      let claimed;
      try {
        claimed = await this.client.claim(c.id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue; // taken, expired or gone
        throw e;
      }
      const result = await executeCommand(claimed, { cfg: this.cfg, log: this.log, safetyBackup: this.safetyBackup() });
      this.state.results[c.id] = result;
      await this.save(); // remember the outcome before telling LifeOS, so a crash can never re-run it
      try {
        await this.client.reportResult(c.id, result);
        delete this.state.results[c.id];
      } catch (e) {
        if (!(e instanceof ApiError) || !e.transient) delete this.state.results[c.id];
        else this.log.warn("could not deliver result yet", { command: c.id });
      }
      this.log.info("command finished", { op: claimed.op, status: result.status });
      if (result.status === "applied") {
        this.approveRemovals(claimed.op, claimed.payload);
        this.requestSync("command");
      }
    }
  }

  /** The owner approved deleting a note or folder: its cloud copies are removed even if the mass-removal brake would stop it. */
  private approveRemovals(op: string, payload: Record<string, unknown>) {
    const p = typeof payload.path === "string" ? payload.path.toLowerCase() : "";
    if (!p || (op !== "delete_note" && op !== "delete_folder")) return;
    for (const [id, d] of Object.entries(this.state.docs)) {
      const path = d.path.toLowerCase();
      if ((op === "delete_note" ? path === p : path.startsWith(`${p}/`)) && !this.state.removalApproved.includes(id)) this.state.removalApproved.push(id);
    }
  }

  /** A PDF's local state is dropped when LifeOS re-enables it, so it is read and uploaded again; revoked ones are marked. */
  private resetPdfState(id: string, revoked: boolean) {
    for (const [rel, p] of Object.entries(this.state.pdfs)) {
      if (p.id !== id) continue;
      if (revoked) p.status = "blocked_revoked";
      else delete this.state.pdfs[rel];
    }
  }

  /* -------------------------------- backups -------------------------------- */

  /** Used by approved changes: the primary local backup must succeed first, or nothing is changed. */
  private safetyBackup(): SafetyBackup {
    if (this.o.safetyBackup) return this.o.safetyBackup;
    const b = this.o.backups;
    return b
      ? async (reason) => {
          const r = await b.safetyBackup(reason);
          this.record([{ destination: "local", status: r.ok ? "ok" : "failed", message: r.message, snapshotId: r.snapshotId }], false);
          return r;
        }
      : noBackupConfigured;
  }

  private record(results: DestResult[], save = true) {
    const at = new Date().toISOString();
    for (const r of results) {
      const prev = this.state.backup[r.destination];
      this.state.backup[r.destination] = { status: r.status, at, message: r.message, snapshotId: r.snapshotId, files: r.files, bytes: r.bytes, lastSuccessAt: r.status === "ok" ? at : prev?.lastSuccessAt };
    }
    if (save) void this.save();
  }

  /** Run a scheduled backup if a daily, weekly or monthly cycle has none yet. Quiet when nothing is due. */
  async checkBackups(): Promise<DestResult[] | null> {
    const b = this.o.backups;
    if (!b || this.stopped) return null;
    return this.exclusive(async () => {
      const results = await b.runScheduled();
      if (!results) return null;
      this.record(results);
      await this.heartbeat(true, undefined, undefined, false).catch(() => {});
      return results;
    });
  }

  async backupNow(opts: { full?: boolean } = {}): Promise<DestResult[]> {
    const b = this.o.backups;
    if (!b) throw new Error("Backups are not set up. Run: obsidian-bridge setup");
    return this.exclusive(async () => {
      const results = await b.backupNow(opts);
      this.record(results);
      await this.heartbeat(true, undefined, undefined, false).catch(() => {});
      return results;
    });
  }

  /* -------------------------------- syncing -------------------------------- */

  isPaused() {
    return !!this.state.paused || this.ownerPaused;
  }

  private startWatcher() {
    try {
      this.watcher = watch(this.cfg.vaultPath, { recursive: true }, (_event, file) => {
        const f = String(file ?? "");
        if (!f || f.split("/").some((s) => s.startsWith("."))) return; // .obsidian, .trash, temp files
        this.requestSync("file change");
      });
      this.watcher.on("error", (e) => {
        this.log.warn("file watcher stopped, restarting", { error: (e as Error).message });
        this.watcher?.close();
        setTimeout(() => !this.stopped && this.startWatcher(), 5000);
      });
    } catch (e) {
      this.log.warn("could not watch the vault; relying on periodic checks", { error: (e as Error).message });
    }
  }

  /** Wait a moment so a burst of saves becomes one sync. */
  requestSync(reason: string) {
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(reason), this.o.debounceMs ?? 2000);
  }

  async syncNow(reason = "manual", opts: { allowAllRemovals?: boolean } = {}): Promise<SyncReport | null> {
    if (this.deviceRevoked || this.isPaused() || !this.cfg.initialSyncConfirmedAt) return null;
    if (this.syncing) {
      this.syncWanted = true;
      return null;
    }
    return this.exclusive(async () => {
      this.syncing = true;
      this.syncWanted = false;
      try {
        await this.heartbeat(true, "syncing");
        const report = await syncVault({
          cfg: this.cfg,
          state: this.state,
          api: this.client,
          extractPdf: this.o.extractPdf,
          log: this.log,
          persist: () => this.save(),
          allowAllRemovals: opts.allowAllRemovals,
        });
        this.log.info("sync finished", { reason, uploaded: report.uploaded, removed: report.removed, pathUpdates: report.pathUpdates, blocked: report.blocked });
        this.online = true;
        await this.heartbeat(true, report.errors.length ? "error" : "idle", report.errors[0], true);
        return report;
      } catch (e) {
        if (e instanceof SyncNotConfirmedError) return null;
        if (e instanceof DeviceRevokedError) await this.handlePollError(e);
        else {
          this.state.lastError = (e as Error).message;
          this.fails = Math.max(this.fails, 1);
          this.log.warn("sync failed, will retry", { error: (e as Error).message });
          await this.heartbeat(true, "error", (e as Error).message).catch(() => {});
        }
        return null;
      } finally {
        this.syncing = false;
        await this.save();
        if (this.syncWanted && !this.stopped) this.requestSync("queued");
      }
    });
  }

  /** Tell LifeOS how the Bridge is doing. Not on every poll: only when something changed, plus every 10 minutes. */
  private async heartbeat(force: boolean, status?: "idle" | "syncing" | "paused" | "error", error?: string, success = false) {
    const st = status ?? (this.isPaused() ? "paused" : this.state.lastError && !this.online ? "error" : "idle");
    const key = `${st}:${error ?? ""}:${this.syncRequestSeen}`;
    if (!force && key === this.lastBeatStatus && Date.now() - this.lastHeartbeat < 10 * 60_000) return;
    try {
      await this.client.heartbeat({
        status: st,
        error,
        success,
        sync_request_seen: this.syncRequestSeen || undefined,
        details: { ...this.backupDetails(), notes: Object.values(this.state.docs).filter((d) => d.status === "synced").length, blocked: Object.values(this.state.docs).filter((d) => d.status === "blocked_secret").length, pdfs: Object.values(this.state.pdfs).filter((p) => p.status === "synced").length, version: "0.1.0" },
      });
      this.lastHeartbeat = Date.now();
      this.lastBeatStatus = key;
      this.syncRequestSeen = false;
    } catch (e) {
      if (e instanceof DeviceRevokedError) throw e;
    }
  }

  private backupDetails(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of ["local", "external"] as const) {
      const s = this.state.backup[d];
      if (!s) continue;
      out[`backup_${d}`] = s.status === "ok" ? "ok" : s.status === "unavailable" ? "unavailable" : "failed";
      if (s.lastSuccessAt) out[`backup_${d}_at`] = s.lastSuccessAt;
    }
    return out;
  }

  /* --------------------------------- control -------------------------------- */

  async setPaused(paused: boolean) {
    this.state.paused = paused;
    await this.save();
    await this.heartbeat(true, paused ? "paused" : "idle").catch(() => {});
    if (!paused) this.requestSync("resume");
  }

  async confirmInitialSync() {
    this.cfg.initialSyncConfirmedAt = new Date().toISOString();
    await saveConfig(this.cfg, this.o.configFile);
    this.requestSync("initial sync confirmed");
  }

  status(): ServiceStatus {
    const count = <T extends { status: string }>(o: Record<string, T>) => Object.values(o).reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
    const day = new Date().toISOString().slice(0, 10);
    return {
      running: true,
      online: this.online,
      paused: this.isPaused(),
      pausedByOwnerInLifeos: this.ownerPaused,
      initialSyncConfirmed: !!this.cfg.initialSyncConfirmedAt,
      syncing: this.syncing,
      deviceRevoked: this.deviceRevoked,
      lastSyncAt: this.state.lastSyncAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastError: this.state.lastError,
      pendingCommands: this.pendingCommands,
      awaitingApproval: this.awaitingApproval,
      docs: count(this.state.docs),
      pdfs: count(this.state.pdfs),
      usageToday: this.state.usage[day] ?? { requests: 0, polls: 0 },
      pollSeconds: this.cfg.pollSeconds,
      backoffSeconds: this.fails ? Math.round(this.nextDelayMs() / 1000) : 0,
      backup: { configured: !!this.o.backups, local: this.state.backup.local, external: this.state.backup.external },
    };
  }

  /* ------------------------------ local control socket ------------------------------ */

  private async listen() {
    await mkdir(dirname(this.o.socketPath), { recursive: true, mode: 0o700 });
    await rm(this.o.socketPath, { force: true });
    this.server = createServer((sock) => {
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", async (d) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          sock.write(JSON.stringify(await this.handle(line)) + "\n");
        }
      });
      sock.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.o.socketPath, () => resolve());
    });
    await chmod(this.o.socketPath, 0o600); // only this user can talk to the Bridge
  }

  private async handle(line: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    try {
      const { cmd, args } = JSON.parse(line) as { cmd: string; args?: Record<string, unknown> };
      switch (cmd) {
        case "status":
          return { ok: true, data: this.status() };
        case "sync":
          return { ok: true, data: (await this.syncNow("manual", { allowAllRemovals: args?.allowRemovals === true })) ?? { skipped: this.isPaused() ? "paused" : this.syncing ? "already running" : "not ready" } };
        case "pause":
          await this.setPaused(true);
          return { ok: true, data: this.status() };
        case "resume":
          await this.setPaused(false);
          return { ok: true, data: this.status() };
        case "backup":
          return { ok: true, data: await this.backupNow({ full: args?.full === true }) };
        case "backup-list":
          if (!this.o.backups) throw new Error("Backups are not set up");
          return { ok: true, data: (await this.o.backups.list()).map((d) => ({ ...d, snapshots: d.snapshots.map((s) => ({ id: s.id, createdAt: s.createdAt, labels: s.labels, mode: s.mode, files: s.fileCount, bytes: s.totalBytes })) })) };
        case "preview":
          return { ok: true, data: await previewInitialSync(this.cfg.vaultPath, { pdfMaxBytes: this.cfg.pdfMaxBytes }) };
        case "confirm-initial-sync":
          await this.confirmInitialSync();
          return { ok: true, data: this.status() };
        case "reenable": {
          const id = String(args?.id ?? "");
          const res = await this.client.reenable(id);
          delete this.state.revoked[id];
          this.state.grants[id] = res.grant_version;
          this.resetPdfState(id, false);
          const file = await findNoteById(this.cfg.vaultPath, id);
          if (file) await setSyncFlag(file, true);
          delete this.state.docs[id];
          this.requestSync("re-enable");
          return { ok: true, data: res };
        }
        case "shutdown":
          setTimeout(() => void this.stop().then(() => process.exit(0)), 50);
          return { ok: true };
        default:
          return { ok: false, error: `Unknown command: ${cmd}` };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

