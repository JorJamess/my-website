import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { BackupManager, type DestResult } from "../backup/manager.js";
import { applyMerge, browse, conflictDiff, planMerge, restorePreview, restoreToNewVault, type Resolution } from "../backup/restore.js";
import { MacVolumes } from "../backup/volumes.js";
import type { BridgeConfig } from "../config/config.js";
import { fileLogger, silentLogger } from "../logging.js";
import { paths } from "../config/config.js";
import { callService } from "../service/ipc.js";
import { fmtBytes } from "./system.js";

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");
type Flags = Record<string, string | true>;

export const makeManager = (cfg: BridgeConfig, quiet = false) =>
  new BackupManager({ vaultPath: cfg.vaultPath, vaultName: cfg.vaultName, settings: cfg.backup, volumes: new MacVolumes(), log: quiet ? silentLogger : fileLogger(paths().log) });

const when = (iso: string) => new Date(iso).toLocaleString();

function printResults(results: DestResult[]) {
  for (const r of results) {
    const name = r.destination === "local" ? "Local folder" : "External SSD";
    if (r.status === "ok") out(`✓ ${name}: ${r.mode} backup verified (${r.files} files, ${fmtBytes(r.bytes ?? 0)})${r.pruned ? `, ${r.pruned} old backup(s) removed` : ""}`);
    else out(`${r.status === "unavailable" ? "!" : "✗"} ${name}: ${r.message ?? r.status}`);
  }
}

export async function backupCommand(cfg: BridgeConfig, words: string[], flags: Flags): Promise<number> {
  if (!cfg.backup.localPath) {
    err("No backup folder is set up. Run: obsidian-bridge setup");
    return 1;
  }
  if (words[1] === "list") {
    for (const d of await makeManager(cfg, true).list()) {
      out(`${d.destination === "local" ? "Local folder" : "External SSD"}${d.available ? "" : `  (unavailable: ${d.reason})`}`);
      for (const s of d.snapshots) out(`  ${s.id}  ${when(s.createdAt).padEnd(22)} ${s.mode.padEnd(11)} ${String(s.fileCount).padStart(6)} files  ${fmtBytes(s.totalBytes).padStart(9)}  ${(s.labels as string[]).join("+")}`);
      if (d.available && !d.snapshots.length) out("  no backups yet");
    }
    return 0;
  }
  const live = await callService<DestResult[]>(paths().socket, "backup", { full: flags.full === true }, 3_600_000);
  const results = live ? (live.ok ? live.data! : null) : await makeManager(cfg).backupNow({ full: flags.full === true });
  if (!results) {
    err(`Backup failed: ${live?.error}`);
    return 1;
  }
  printResults(results);
  const local = results.find((r) => r.destination === "local");
  return local?.status === "ok" ? 0 : 1;
}

async function chooseSnapshot(cfg: BridgeConfig, idArg: string | undefined, destFlag: string | true | undefined) {
  const lists = (await makeManager(cfg, true).list()).filter((d) => d.available && (typeof destFlag !== "string" || d.destination === destFlag));
  const all = lists.flatMap((d) => d.snapshots.map((s) => ({ ...s, destination: d.destination, dir: d.dir! })));
  if (!idArg) return { all, pick: null };
  const hits = all.filter((s) => s.id.startsWith(idArg));
  if (hits.length === 0) throw new Error("No backup matches that id. Run: obsidian-bridge backup list");
  if (hits.length > 1 && new Set(hits.map((h) => h.id)).size > 1) throw new Error("That id matches several backups; type more of it.");
  return { all, pick: hits[0] };
}

export async function restoreCommand(cfg: BridgeConfig, words: string[], flags: Flags): Promise<number> {
  const sub = words[1];
  const idArg = sub === "preview" ? words[2] : sub;
  const { all, pick } = await chooseSnapshot(cfg, idArg, flags.from);

  if (sub === "preview" || !sub) {
    if (!pick) {
      out("Restore points (newest first):");
      for (const s of all) out(`  ${s.id}  ${when(s.createdAt).padEnd(22)} ${s.destination.padEnd(8)} ${String(s.fileCount).padStart(6)} files  ${(s.labels as string[]).join("+")}`);
      if (!all.length) out("  none yet. Run: obsidian-bridge backup");
      out("\nPreview one: obsidian-bridge restore preview <id>   (nothing is changed)");
      return 0;
    }
    if (typeof flags.browse === "string" || flags.browse === true) {
      for (const e of await browse(pick.dir, pick.id, typeof flags.browse === "string" ? flags.browse : "")) out(`  ${e.type === "folder" ? e.name + "/" : e.name.padEnd(40) + fmtBytes(e.size ?? 0)}`);
      return 0;
    }
    const p = await restorePreview(pick.dir, pick.id);
    out(`Backup ${p.id}  (${pick.destination})\n  made ${when(p.createdAt)}, ${p.mode}, ${p.labels.join("+")}\n  ${p.files} files, ${p.folders} folders, ${fmtBytes(p.bytes)}\n  ${p.intact ? "✓ complete" : "✗ DAMAGED: " + p.problems[0]}`);
    for (const t of p.topLevel.slice(0, 30)) out(`    ${t.name}  (${t.files})`);
    if (p.unstable.length) out(`  ${p.unstable.length} file(s) were being edited while this backup ran`);
    out("\nBrowse: --browse [folder]. Restore: --new-vault <folder>   or   --merge");
    return p.intact ? 0 : 1;
  }

  if (!pick) throw new Error("Choose a backup: obsidian-bridge restore <id> --new-vault <folder> | --merge");
  if (typeof flags["new-vault"] === "string") {
    const r = await restoreToNewVault(pick.dir, pick.id, resolve(flags["new-vault"]), { currentVault: cfg.vaultPath });
    out(`✓ Restored ${r.files} files (${fmtBytes(r.bytes)}) into ${r.target}\n  Your current vault was not touched. Open the new folder in Obsidian as a vault.`);
    return 0;
  }
  if (flags.merge) return merge(cfg, pick, flags);
  throw new Error("Say how to restore: --new-vault <folder> or --merge");
}

async function merge(cfg: BridgeConfig, pick: { id: string; dir: string }, flags: Flags): Promise<number> {
  const plan = await planMerge(pick.dir, pick.id, cfg.vaultPath);
  out(`Safe merge of ${pick.id} into your vault:\n  ${plan.add.length} missing file(s) will be added\n  ${plan.identical} identical file(s) are skipped\n  ${plan.conflicts.length} file(s) differ from the backup`);
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const resolutions: Record<string, Resolution> = {};
    const preset: Resolution | undefined = flags["keep-both"] ? "keep_both" : flags["keep-current"] ? "keep_current" : flags.overwrite ? "restore_backup" : undefined;
    let confirmOverwrite = flags["confirm-overwrite"] === true;
    if (!preset && plan.conflicts.length && rl) {
      for (const p of plan.conflicts) {
        out(`\n${p}`);
        out((await conflictDiff(pick.dir, pick.id, cfg.vaultPath, p)).split("\n").slice(0, 40).join("\n"));
        const a = (await rl.question("  [c] keep current   [b] keep both   [r] restore backup version   > ")).trim().toLowerCase();
        resolutions[p] = a === "b" ? "keep_both" : a === "r" ? "restore_backup" : "keep_current";
      }
      if (Object.values(resolutions).includes("restore_backup")) confirmOverwrite = /^y(es)?$/i.test((await rl.question("Replace the current version of the files marked [r]? A safety backup is made first. (yes/no): ")).trim());
      if (!confirmOverwrite) for (const k of Object.keys(resolutions)) if (resolutions[k] === "restore_backup") resolutions[k] = "keep_current";
    } else if (!preset && plan.conflicts.length) out("  (not interactive: differing files are kept as they are; use --keep-both, --keep-current or --overwrite --confirm-overwrite)");
    if (preset === "restore_backup" && !confirmOverwrite) throw new Error("--overwrite also needs --confirm-overwrite");
    if (rl && !flags.yes && !/^y(es)?$/i.test((await rl.question("\nGo ahead? A safety backup is made first. (yes/no): ")).trim())) return (out("Cancelled. Nothing was changed."), 1);
    const manager = makeManager(cfg);
    const report = await applyMerge(pick.dir, pick.id, cfg.vaultPath, { resolutions, defaultResolution: preset, confirmOverwrite, safetyBackup: () => manager.safetyBackup("restore") });
    out(`\n✓ Added ${report.added}, skipped ${report.skippedIdentical} identical, kept ${report.keptCurrent} current, replaced ${report.overwritten}, kept both for ${report.keptBoth.length}.`);
    for (const k of report.keptBoth) out(`  ${k.path}  →  restored copy: ${k.restoredAs}`);
    if (report.linkNote) out(`  ${report.linkNote}`);
    out(`  Safety backup before this restore: ${report.safetyBackupId}`);
    return 0;
  } finally {
    rl?.close();
  }
}
