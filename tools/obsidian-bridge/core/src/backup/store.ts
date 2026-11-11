import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, link, mkdir, open, readFile, readdir, readlink, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { RETENTION, type Label } from "./schedule.js";

export type SnapshotLabel = Label | "safety" | "manual";
export type ManifestEntry = { path: string; type: "file" | "symlink"; size: number; mtimeMs: number; mode: number; target?: string };
export type SnapshotManifest = {
  version: 1;
  id: string;
  createdAt: string;
  vaultName: string;
  labels: SnapshotLabel[];
  cycles: Partial<Record<Label, string>>;
  mode: "full" | "incremental";
  reason?: string;
  files: ManifestEntry[];
  dirs: string[];
  fileCount: number;
  totalBytes: number;
  /** files that kept changing while they were copied (still included, as last copied) */
  unstable: string[];
  linkedFiles: number;
  copiedFiles: number;
  /** what is left out on purpose */
  excluded: string;
};

export const EXCLUDE_NOTE = "Only temporary files written by the Bridge itself (*.bridge-tmp) and macOS .DS_Store files. Everything else is included, including .obsidian, .trash and hidden files.";
const excluded = (name: string) => name.endsWith(".bridge-tmp") || name === ".DS_Store";

export class BackupError extends Error {}

/** Everything in the vault, with hidden files, symlinks kept as links (never followed). */
export async function scanSource(root: string) {
  const files: ManifestEntry[] = [];
  const dirs: string[] = [];
  async function visit(abs: string, rel: string) {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      if (excluded(e.name)) continue;
      const p = join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        const s = await lstat(p);
        files.push({ path: r, type: "symlink", size: 0, mtimeMs: s.mtimeMs, mode: s.mode & 0o777, target: await readlink(p) });
      } else if (e.isDirectory()) {
        dirs.push(r);
        await visit(p, r);
      } else if (e.isFile()) {
        const s = await stat(p);
        files.push({ path: r, type: "file", size: s.size, mtimeMs: s.mtimeMs, mode: s.mode & 0o777 });
      }
    }
  }
  await visit(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, dirs: dirs.sort() };
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");

export async function listSnapshots(destDir: string): Promise<SnapshotManifest[]> {
  const dir = join(destDir, "snapshots");
  const out: SnapshotManifest[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name.startsWith(".")) continue; // unfinished
    try {
      const m = JSON.parse(await readFile(join(dir, name, "manifest.json"), "utf8")) as SnapshotManifest;
      if (m.version === 1 && m.id === name) out.push(m);
    } catch {
      /* not a complete snapshot: ignored, never offered for restore */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const snapshotFilesDir = (destDir: string, id: string) => join(destDir, "snapshots", id, "files");

async function sameFile(prevRoot: string, prev: ManifestEntry | undefined, cur: ManifestEntry) {
  if (!prev || prev.type !== "file" || cur.type !== "file" || prev.size !== cur.size || prev.mtimeMs !== cur.mtimeMs) return false;
  const s = await stat(join(prevRoot, ...prev.path.split("/"))).catch(() => null);
  return !!s && s.isFile() && s.size === prev.size;
}

export type CreateOptions = {
  vaultPath: string;
  vaultName: string;
  labels: SnapshotLabel[];
  cycles?: Partial<Record<Label, string>>;
  mode: "full" | "incremental";
  reason?: string;
  now?: Date;
  /** test hook: called after each file is copied */
  afterCopy?: (rel: string) => Promise<void> | void;
};

/**
 * Build one snapshot as a complete, independent folder tree. Unchanged files are hard links to the previous snapshot's
 * files (so deleting any snapshot never affects another); a full snapshot copies every file. It is built in a hidden
 * work folder and renamed into place only after it passed verification, so a crash never leaves a half snapshot that
 * looks complete.
 */
export async function createSnapshot(destDir: string, o: CreateOptions): Promise<{ manifest: SnapshotManifest; verify: VerifyResult }> {
  const now = o.now ?? new Date();
  const id = `${stamp(now)}-${randomBytes(2).toString("hex")}`;
  const snaps = join(destDir, "snapshots");
  const work = join(snaps, `.${id}.partial`);
  await mkdir(work, { recursive: true });
  await cleanPartials(snaps, work);
  const filesRoot = join(work, "files");
  await mkdir(filesRoot);

  const source = await scanSource(o.vaultPath);
  const previous = o.mode === "incremental" ? (await listSnapshots(destDir))[0] : undefined;
  const prevMap = new Map(previous?.files.map((f) => [f.path, f]));
  const prevRoot = previous ? snapshotFilesDir(destDir, previous.id) : "";
  let linkOk = !!previous;
  let linked = 0;
  let copied = 0;
  const unstable: string[] = [];
  try {
    for (const d of source.dirs) await mkdir(join(filesRoot, ...d.split("/")), { recursive: true });
    const entries: ManifestEntry[] = [];
    for (const f of source.files) {
      const src = join(o.vaultPath, ...f.path.split("/"));
      const dst = join(filesRoot, ...f.path.split("/"));
      await mkdir(dirname(dst), { recursive: true });
      if (f.type === "symlink") {
        await symlink(f.target!, dst);
        entries.push(f);
        continue;
      }
      if (linkOk && (await sameFile(prevRoot, prevMap.get(f.path), f))) {
        try {
          await link(join(prevRoot, ...f.path.split("/")), dst);
          linked++;
          entries.push(f);
          continue;
        } catch {
          linkOk = false; // this drive can't hard link: copy from here on
        }
      }
      // copy, and make sure the file didn't change underneath us (Obsidian may be saving)
      let final = f;
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await stat(src).catch(() => null);
        if (!before) throw new BackupError(`A file disappeared while backing up: ${f.path}`);
        await copyFile(src, dst, o.mode === "full" ? 0 : constants.COPYFILE_FICLONE);
        await o.afterCopy?.(f.path); // test hook: lets a test change the file "during" the copy
        const after = await stat(src).catch(() => null);
        final = { ...f, size: before.size, mtimeMs: before.mtimeMs };
        if (after && after.size === before.size && after.mtimeMs === before.mtimeMs) {
          if (attempt > 0) unstable.splice(unstable.indexOf(f.path), 1);
          break;
        }
        if (attempt === 0) unstable.push(f.path);
        final = { ...f, size: after?.size ?? 0, mtimeMs: after?.mtimeMs ?? 0 };
      }
      await utimes(dst, new Date(), new Date(final.mtimeMs)).catch(() => {});
      copied++;
      entries.push(final);
    }
    const manifest: SnapshotManifest = {
      version: 1,
      id,
      createdAt: now.toISOString(),
      vaultName: o.vaultName,
      labels: o.labels,
      cycles: o.cycles ?? {},
      mode: o.mode,
      reason: o.reason,
      files: entries,
      dirs: source.dirs,
      fileCount: entries.length,
      totalBytes: entries.reduce((a, f) => a + f.size, 0),
      unstable: [...new Set(unstable)],
      linkedFiles: linked,
      copiedFiles: copied,
      excluded: EXCLUDE_NOTE,
    };
    await writeFile(join(work, "manifest.json"), JSON.stringify(manifest));
    // verify the work folder as if it were the finished snapshot, before it becomes visible
    const verify = await verifyDir(work, manifest, entries.length);
    if (!verify.ok) throw new BackupError(`Verification failed: ${verify.problems.slice(0, 3).join("; ")}`);
    await rename(work, join(snaps, id));
    return { manifest, verify };
  } catch (e) {
    await rm(work, { recursive: true, force: true });
    throw e;
  }
}

async function cleanPartials(snaps: string, keep: string) {
  for (const n of await readdir(snaps).catch(() => [] as string[])) if (n.startsWith(".") && n.endsWith(".partial") && join(snaps, n) !== keep) await rm(join(snaps, n), { recursive: true, force: true });
}

export type VerifyResult = { ok: boolean; files: number; bytes: number; problems: string[] };

async function readable(p: string) {
  const fh = await open(p, "r");
  try {
    await fh.read(Buffer.alloc(1), 0, 1, 0);
  } finally {
    await fh.close();
  }
}

/** Basic verification: manifest present, file count matches, every path present with the recorded size, every file readable. */
async function verifyDir(snapDir: string, manifest: SnapshotManifest, expectedCount?: number): Promise<VerifyResult> {
  const problems: string[] = [];
  if (expectedCount !== undefined && manifest.fileCount !== expectedCount) problems.push(`manifest lists ${manifest.fileCount} files but ${expectedCount} were in the vault`);
  if (manifest.files.length !== manifest.fileCount) problems.push("manifest file count does not match its list");
  const root = join(snapDir, "files");
  // what is actually on disk
  const onDisk = new Set<string>();
  async function walk(abs: string, rel: string) {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(abs, e.name), r);
      else onDisk.add(r);
    }
  }
  await walk(root, "").catch(() => problems.push("snapshot files folder is missing"));
  if (onDisk.size !== manifest.fileCount) problems.push(`snapshot holds ${onDisk.size} files, manifest says ${manifest.fileCount}`);
  let bytes = 0;
  for (const f of manifest.files) {
    const p = join(root, ...f.path.split("/"));
    try {
      if (f.type === "symlink") {
        if ((await readlink(p)) !== f.target) problems.push(`link changed: ${f.path}`);
        continue;
      }
      const s = await stat(p);
      if (s.size !== f.size) problems.push(`size differs: ${f.path}`);
      await readable(p);
      bytes += s.size;
    } catch {
      problems.push(`missing or unreadable: ${f.path}`);
    }
    if (problems.length > 50) break;
  }
  return { ok: problems.length === 0, files: manifest.fileCount, bytes, problems };
}

export async function verifySnapshot(destDir: string, id: string): Promise<VerifyResult> {
  try {
    const manifest = JSON.parse(await readFile(join(destDir, "snapshots", id, "manifest.json"), "utf8")) as SnapshotManifest;
    return await verifyDir(join(destDir, "snapshots", id), manifest);
  } catch {
    return { ok: false, files: 0, bytes: 0, problems: ["manifest missing or unreadable"] };
  }
}

/**
 * Keep the newest N snapshots per label (daily 7, weekly 4, monthly 3, safety 10, manual 5). A snapshot is kept if any
 * label keeps it. Run only after a new snapshot was verified, and it first checks that every snapshot it is about to
 * keep is still complete: if one is damaged nothing is deleted at all.
 */
export async function pruneSnapshots(destDir: string, policy: Record<string, number> = RETENTION) {
  const all = await listSnapshots(destDir);
  const keep = new Set<string>();
  for (const [label, n] of Object.entries(policy)) {
    for (const s of all.filter((x) => (x.labels as string[]).includes(label)).slice(0, n)) keep.add(s.id);
  }
  // a snapshot with no known label is never deleted automatically
  for (const s of all) if (!s.labels.some((l) => l in policy)) keep.add(s.id);
  const remove = all.filter((s) => !keep.has(s.id));
  if (!remove.length) return { kept: [...keep], deleted: [] as string[], skipped: null as string | null };
  for (const id of keep) {
    const v = await verifySnapshot(destDir, id);
    if (!v.ok) return { kept: [...keep], deleted: [], skipped: `Not deleting old backups: ${id} is not complete (${v.problems[0]})` };
  }
  for (const s of remove) await rm(join(destDir, "snapshots", s.id), { recursive: true, force: true });
  return { kept: [...keep], deleted: remove.map((s) => s.id), skipped: null };
}

export async function hashOf(p: string) {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  for await (const c of createReadStream(p)) h.update(c as Buffer);
  return h.digest("hex");
}

export const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
