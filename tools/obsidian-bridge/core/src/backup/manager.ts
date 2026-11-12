import { access, constants, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logging.js";
import { insideOrSame, realish } from "./paths.js";
import { cycleKeys, dueLabels, modeFor, type Label } from "./schedule.js";

import { createSnapshot, listSnapshots, listSnapshotSummaries, pruneSnapshots, type SnapshotLabel, type SnapshotManifest } from "./store.js";
import type { VolumeProvider } from "./volumes.js";

/** while a destination is unavailable (an unplugged SSD) it is looked for at most this often */
const UNAVAILABLE_RECHECK_MS = 5 * 60_000;

export type BackupSettings = { localPath: string | null; externalPath: string | null; externalVolumeUuid?: string | null; externalSubpath?: string | null; allowUnencrypted?: boolean };

export type DestResult = {
  destination: "local" | "external";
  status: "ok" | "unavailable" | "failed";
  message?: string;
  snapshotId?: string;
  verifiedAt?: string;
  files?: number;
  bytes?: number;
  labels?: string[];
  mode?: "full" | "incremental";
  pruned?: number;
  encrypted?: boolean | null;
};

export type Destination = { name: "local" | "external"; dir: string | null; reason?: string };

const safeName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]/g, "_").slice(0, 80) || "Vault";

/** Runs backups to the local folder (required) and the external drive (optional), and reports each separately. */
export class BackupManager {
  constructor(
    private o: { vaultPath: string; vaultName: string; settings: BackupSettings; volumes: VolumeProvider; log: Logger; now?: () => Date },
  ) {}

  private get now() {
    return this.o.now?.() ?? new Date();
  }

  /** destinations that have every scheduled cycle of the current period; while it holds, a check costs nothing */
  private satisfied: { keys: string; dests: Set<string> } = { keys: "", dests: new Set() };
  private unavailableUntil = 0;

  private expectedDestinations() {
    const s = this.o.settings;
    return [...(s.localPath ? ["local"] : []), ...(s.externalPath || s.externalVolumeUuid ? ["external"] : [])];
  }

  /** Where each destination's snapshots live right now. The external drive is found by its volume id, not a fixed path. */
  async destinations(): Promise<Destination[]> {
    const s = this.o.settings;
    const out: Destination[] = [];
    const sub = join("ObsidianBridge", safeName(this.o.vaultName));
    if (!s.localPath) out.push({ name: "local", dir: null, reason: "No local backup folder is set up" });
    else out.push(await this.usable("local", join(s.localPath, sub), s.localPath));
    if (s.externalPath || s.externalVolumeUuid) {
      let root: string | null = null;
      if (s.externalVolumeUuid) {
        const mount = await this.o.volumes.findByUuid(s.externalVolumeUuid);
        root = mount ? join(mount, s.externalSubpath ?? "") : null;
        if (root) await mkdir(root, { recursive: true }).catch(() => {}); // the folder on the drive may not exist yet
      } else root = s.externalPath;
      out.push(root ? await this.usable("external", join(root, sub), root) : { name: "external", dir: null, reason: "External Backup Unavailable: the drive is not connected" });
    }
    return out;
  }

  private async usable(name: "local" | "external", dir: string, root: string): Promise<Destination> {
    try {
      // checked again here, not only at setup: the external folder is rebuilt from the drive's id and a subfolder
      if (insideOrSame(await realish(root), await realish(this.o.vaultPath))) return { name, dir: null, reason: `The ${name} backup folder is inside the vault, so it is not used` };
      await access(root, constants.W_OK);
      await mkdir(join(dir, "snapshots"), { recursive: true });
      const info = await this.o.volumes.info(root);
      if (info.encrypted === false && !this.o.settings.allowUnencrypted) return { name, dir: null, reason: `The ${name} backup drive is not encrypted. Enable encryption, or accept the warning in setup.` };
      return { name, dir };
    } catch {
      return { name, dir: null, reason: name === "external" ? "External Backup Unavailable: the folder can't be written" : "The local backup folder can't be written" };
    }
  }

  async list(): Promise<{ destination: "local" | "external"; available: boolean; reason?: string; dir: string | null; snapshots: SnapshotManifest[] }[]> {
    const out = [];
    for (const d of await this.destinations()) out.push({ destination: d.name, available: !!d.dir, reason: d.reason, dir: d.dir, snapshots: d.dir ? await listSnapshots(d.dir) : [] });
    return out;
  }

  private async one(d: Destination, labels: SnapshotLabel[], mode: "full" | "incremental", reason?: string): Promise<DestResult> {
    if (!d.dir) return { destination: d.name, status: "unavailable", message: d.reason };
    const now = this.now;
    try {
      const keys = cycleKeys(now);
      const cycles: Partial<Record<Label, string>> = {};
      for (const l of labels) if (l === "daily" || l === "weekly" || l === "monthly") cycles[l] = keys[l];
      const { manifest, verify } = await createSnapshot(d.dir, { vaultPath: this.o.vaultPath, vaultName: this.o.vaultName, labels, cycles, mode, reason, now });
      // only now is it a success; old backups are removed after the new one is verified
      const pruned = await pruneSnapshots(d.dir);
      if (pruned.skipped) this.o.log.warn("retention skipped", { message: pruned.skipped });
      const info = await this.o.volumes.info(d.dir);
      this.o.log.info("backup done", { destination: d.name, snapshot: manifest.id, files: manifest.fileCount, mode: manifest.mode });
      return { destination: d.name, status: "ok", snapshotId: manifest.id, verifiedAt: new Date().toISOString(), files: verify.files, bytes: verify.bytes, labels: manifest.labels, mode: manifest.mode, pruned: pruned.deleted.length, encrypted: info.encrypted };
    } catch (e) {
      this.o.log.error("backup failed", { destination: d.name, error: (e as Error).message });
      return { destination: d.name, status: "failed", message: (e as Error).message.slice(0, 200) };
    }
  }

  /** Back up whatever scheduled cycle is still missing in each destination. Returns null when nothing was due. */
  async runScheduled(): Promise<DestResult[] | null> {
    const now = this.now;
    const keys = JSON.stringify(cycleKeys(now));
    if (this.satisfied.keys !== keys) {
      this.satisfied = { keys, dests: new Set() };
      this.unavailableUntil = 0;
    }
    const expected = this.expectedDestinations();
    // the common case, every minute: everything for this period is already backed up (or a drive is known to be away)
    if (expected.every((d) => this.satisfied.dests.has(d))) return null;
    if (now.getTime() < this.unavailableUntil && expected.every((d) => this.satisfied.dests.has(d) || d === "external")) return null;
    const results: DestResult[] = [];
    let away = false;
    for (const d of await this.destinations()) {
      const existing = d.dir ? await listSnapshotSummaries(d.dir) : [];
      const due = dueLabels(now, existing);
      if (!d.dir) {
        away = true;
        if (due.length) results.push(await this.one(d, due, "full"));
        continue;
      }
      if (!due.length) {
        this.satisfied.dests.add(d.name);
        continue;
      }
      const r = await this.one(d, due, modeFor(due, existing.length > 0));
      if (r.status === "ok") this.satisfied.dests.add(d.name);
      results.push(r);
    }
    this.unavailableUntil = away ? now.getTime() + UNAVAILABLE_RECHECK_MS : 0;
    return results.length ? results : null;
  }

  /** The owner asked: back up now, to every available destination. */
  async backupNow(opts: { full?: boolean } = {}): Promise<DestResult[]> {
    const results: DestResult[] = [];
    this.satisfied = { keys: "", dests: new Set() }; // look again at everything after a manual backup
    for (const d of await this.destinations()) {
      const existing = d.dir ? await listSnapshotSummaries(d.dir) : [];
      const due = dueLabels(this.now, existing);
      const mode = opts.full ? "full" : modeFor(due, existing.length > 0);
      results.push(await this.one(d, ["manual", ...due], mode, "manual"));
    }
    return results;
  }

  /**
   * Before Claude changes or removes anything: a snapshot in the primary local folder. If it can't be made the change
   * must not happen. The external drive is not required for this.
   */
  async safetyBackup(reason: string): Promise<{ ok: boolean; message?: string; snapshotId?: string }> {
    const local = (await this.destinations()).find((d) => d.name === "local");
    if (!local?.dir) return { ok: false, message: local?.reason ?? "No local backup folder" };
    const r = await this.one(local, ["safety"], "incremental", reason);
    return r.status === "ok" ? { ok: true, snapshotId: r.snapshotId } : { ok: false, message: r.message };
  }
}
