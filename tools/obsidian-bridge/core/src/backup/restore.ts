import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lineDiff } from "../shared/diff.js";
import { BackupError, hashOf, inside, listSnapshots, snapshotFilesDir, verifySnapshot, type ManifestEntry, type SnapshotManifest } from "./store.js";

export type Resolution = "keep_both" | "keep_current" | "restore_backup";

async function manifestOf(destDir: string, id: string): Promise<SnapshotManifest> {
  const m = (await listSnapshots(destDir)).find((s) => s.id === id);
  if (!m) throw new BackupError("That backup was not found or is not complete");
  return m;
}

/** What a restore point contains. Changes nothing. */
export async function restorePreview(destDir: string, id: string) {
  const m = await manifestOf(destDir, id);
  const v = await verifySnapshot(destDir, id);
  const byTop = new Map<string, number>();
  for (const f of m.files) byTop.set(f.path.split("/")[0], (byTop.get(f.path.split("/")[0]) ?? 0) + 1);
  return { id: m.id, createdAt: m.createdAt, labels: m.labels, mode: m.mode, files: m.fileCount, bytes: m.totalBytes, folders: m.dirs.length, intact: v.ok, problems: v.problems, topLevel: [...byTop].map(([name, files]) => ({ name, files })).sort((a, b) => a.name.localeCompare(b.name)), unstable: m.unstable };
}

/** Browse a folder of a restore point (from its manifest). Changes nothing. */
export async function browse(destDir: string, id: string, folder = "") {
  const m = await manifestOf(destDir, id);
  const prefix = folder ? `${folder.replace(/\/+$/, "")}/` : "";
  const seen = new Map<string, { name: string; type: "file" | "folder"; size?: number }>();
  for (const d of m.dirs) if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/") && d.length > prefix.length) seen.set(d.slice(prefix.length), { name: d.slice(prefix.length), type: "folder" });
  for (const f of m.files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i < 0) seen.set(rest, { name: rest, type: "file", size: f.size });
    else if (!seen.has(rest.slice(0, i))) seen.set(rest.slice(0, i), { name: rest.slice(0, i), type: "folder" });
  }
  return [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
}

async function copyOut(src: string, dst: string, f: ManifestEntry, exclusive: boolean) {
  await mkdir(dirname(dst), { recursive: true });
  if (f.type === "symlink") return void (await symlink(f.target!, dst));
  await copyFile(src, dst, exclusive ? constants.COPYFILE_EXCL : 0);
}

/** Restore everything into a brand new folder. The current vault is never touched. */
export async function restoreToNewVault(destDir: string, id: string, target: string, opts: { currentVault?: string } = {}) {
  const m = await manifestOf(destDir, id);
  const to = resolve(target);
  if (inside(to, resolve(destDir))) throw new BackupError("Restore into a folder outside the backup store");
  if (opts.currentVault && (inside(to, resolve(opts.currentVault)) || inside(resolve(opts.currentVault), to))) throw new BackupError("The new vault can't be inside, or contain, your current vault");
  const existing = await readdir(to).catch(() => null);
  if (existing && existing.length) throw new BackupError("That folder is not empty. Choose a new folder.");
  const pre = await verifySnapshot(destDir, id);
  if (!pre.ok) throw new BackupError(`This backup is damaged and was not restored (${pre.problems[0]})`);
  await mkdir(to, { recursive: true });
  const root = snapshotFilesDir(destDir, id);
  for (const d of m.dirs) await mkdir(join(to, ...d.split("/")), { recursive: true });
  for (const f of m.files) await copyOut(join(root, ...f.path.split("/")), join(to, ...f.path.split("/")), f, true);
  // check what we wrote
  let count = 0;
  for (const f of m.files) {
    const s = await lstat(join(to, ...f.path.split("/"))).catch(() => null);
    if (!s || (f.type === "file" && s.size !== f.size)) throw new BackupError(`Restored folder is incomplete near ${f.path}`);
    count++;
  }
  return { files: count, bytes: m.totalBytes, target: to, includesObsidianSettings: m.dirs.includes(".obsidian") };
}

export type MergePlan = { add: string[]; identical: number; conflicts: string[]; addDirs: number };

const same = async (a: string, b: string) => {
  const [sa, sb] = await Promise.all([stat(a), stat(b)]);
  return sa.size === sb.size && (await hashOf(a)) === (await hashOf(b));
};

/** Compare a restore point with the current vault: what is missing, what is identical, what differs. Changes nothing. */
export async function planMerge(destDir: string, id: string, vaultPath: string): Promise<MergePlan> {
  const m = await manifestOf(destDir, id);
  const root = snapshotFilesDir(destDir, id);
  const plan: MergePlan = { add: [], identical: 0, conflicts: [], addDirs: 0 };
  for (const d of m.dirs) if (!(await lstat(join(vaultPath, ...d.split("/"))).catch(() => null))) plan.addDirs++;
  for (const f of m.files) {
    const cur = join(vaultPath, ...f.path.split("/"));
    const s = await lstat(cur).catch(() => null);
    if (!s) plan.add.push(f.path);
    else if (f.type === "symlink") (s.isSymbolicLink() && (await readlink(cur)) === f.target ? plan.identical++ : plan.conflicts.push(f.path));
    else if (!s.isFile()) plan.conflicts.push(f.path);
    else if (await same(join(root, ...f.path.split("/")), cur)) plan.identical++;
    else plan.conflicts.push(f.path);
  }
  return plan;
}

/** What differs in one file: a line diff for text, sizes for anything else. */
export async function conflictDiff(destDir: string, id: string, vaultPath: string, path: string) {
  const backup = join(snapshotFilesDir(destDir, id), ...path.split("/"));
  const current = join(vaultPath, ...path.split("/"));
  const [a, b] = await Promise.all([readFile(current), readFile(backup)]);
  const isText = (buf: Buffer) => !buf.subarray(0, 4000).includes(0);
  if (!isText(a) || !isText(b)) return `Binary file: current ${a.length} bytes, backup ${b.length} bytes`;
  return lineDiff(a.toString("utf8"), b.toString("utf8"));
}

const pad = (n: number) => String(n).padStart(2, "0");

async function uniqueName(dir: string, name: string, when: Date) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const tag = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`;
  for (let i = 0; ; i++) {
    const candidate = `${stem} (restored ${tag}${i ? ` ${i + 1}` : ""})${ext}`;
    if (!(await lstat(join(dir, candidate)).catch(() => null))) return candidate;
  }
}

export type MergeOptions = {
  /** per file; anything not listed uses defaultResolution (keep_current unless told otherwise) */
  resolutions?: Record<string, Resolution>;
  defaultResolution?: Resolution;
  /** required before any current file is replaced by the backup version */
  confirmOverwrite?: boolean;
  safetyBackup: () => Promise<{ ok: boolean; message?: string; snapshotId?: string }>;
  now?: Date;
};

/**
 * Safe merge into the existing vault: a safety backup first (if that fails nothing happens), then add what is missing,
 * skip what is identical, and for files that differ do exactly what the owner chose. Nothing is replaced unless the owner
 * explicitly confirmed "restore backup version" for that file.
 */
export async function applyMerge(destDir: string, id: string, vaultPath: string, o: MergeOptions) {
  const m = await manifestOf(destDir, id);
  const plan = await planMerge(destDir, id, vaultPath);
  const resolution = (p: string): Resolution => o.resolutions?.[p] ?? o.defaultResolution ?? "keep_current";
  if (plan.conflicts.some((p) => resolution(p) === "restore_backup") && !o.confirmOverwrite) throw new BackupError("Replacing current files with the backup version needs explicit confirmation");
  const pre = await verifySnapshot(destDir, id);
  if (!pre.ok) throw new BackupError(`This backup is damaged and was not restored (${pre.problems[0]})`);
  const safety = await o.safetyBackup();
  if (!safety.ok) throw new BackupError(`Safety backup failed, nothing was restored${safety.message ? ` (${safety.message})` : ""}`);

  const root = snapshotFilesDir(destDir, id);
  const entry = new Map(m.files.map((f) => [f.path, f]));
  const report = { added: 0, skippedIdentical: plan.identical, keptCurrent: 0, keptBoth: [] as { path: string; restoredAs: string }[], overwritten: 0, safetyBackupId: safety.snapshotId ?? null, linkNote: null as string | null };
  for (const d of m.dirs) await mkdir(join(vaultPath, ...d.split("/")), { recursive: true });
  for (const p of plan.add) {
    try {
      await copyOut(join(root, ...p.split("/")), join(vaultPath, ...p.split("/")), entry.get(p)!, true);
      report.added++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") plan.conflicts.push(p); // appeared meanwhile: treat as a difference
      else throw e;
    }
  }
  for (const p of plan.conflicts) {
    const src = join(root, ...p.split("/"));
    const cur = join(vaultPath, ...p.split("/"));
    const f = entry.get(p)!;
    switch (resolution(p)) {
      case "keep_current":
        report.keptCurrent++;
        break;
      case "keep_both": {
        const name = await uniqueName(dirname(cur), p.slice(p.lastIndexOf("/") + 1), o.now ?? new Date());
        await copyOut(src, join(dirname(cur), name), f, true);
        report.keptBoth.push({ path: p, restoredAs: `${dirname(p) === "." ? "" : dirname(p) + "/"}${name}` });
        break;
      }
      case "restore_backup": {
        if (f.type === "symlink") {
          await rm(cur, { force: true });
          await symlink(f.target!, cur);
        } else {
          const tmp = `${cur}.${Date.now()}.bridge-tmp`;
          await copyFile(src, tmp);
          await rename(tmp, cur);
        }
        report.overwritten++;
        break;
      }
    }
  }
  if (report.keptBoth.length) report.linkNote = "Links inside your notes were not changed. If a note links to a file that now has a \"(restored …)\" copy, decide which one you want and update the link yourself.";
  return report;
}
