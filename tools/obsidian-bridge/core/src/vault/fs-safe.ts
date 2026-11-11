import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, stat, unlink, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { PathError, validateVaultPath } from "../shared/paths.js";

export class VaultFsError extends Error {}

/** Resolve a vault-relative path to an absolute one, refusing anything that could land outside the vault. */
export async function resolveInVault(root: string, rel: string, opts: { kind: "note" | "folder" | "pdf"; mustExist?: boolean } = { kind: "note" }) {
  let clean: string;
  try {
    clean = validateVaultPath(rel, { kind: opts.kind });
  } catch (e) {
    throw new VaultFsError(e instanceof PathError ? e.message : "Invalid path");
  }
  const rootReal = await realpath(root);
  const abs = join(rootReal, ...clean.split("/"));
  // every existing ancestor (and the target itself, if it exists) must resolve inside the vault: this catches symlink escapes
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== rootReal && !real.startsWith(rootReal + sep)) throw new VaultFsError("That path leaves the vault");
      break;
    } catch (e) {
      if (e instanceof VaultFsError) throw e;
      const parent = dirname(probe);
      if (parent === probe) throw new VaultFsError("Path not found");
      probe = parent;
    }
  }
  if (opts.mustExist) {
    try {
      await lstat(abs);
    } catch {
      throw new VaultFsError("Not found");
    }
  }
  return { abs, rel: clean, rootReal };
}

export const exists = async (p: string) => !!(await lstat(p).catch(() => null));

/** Write a new file next to the target, flush it, then move it into place. Never leaves a half-written file. */
export async function atomicWrite(target: string, data: string | Uint8Array, opts: { exclusive?: boolean } = {}) {
  await mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${randomBytes(6).toString("hex")}.bridge-tmp`);
  const fh = await open(tmp, "wx", 0o644);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    if (opts.exclusive) {
      // link fails if the target exists, so an existing file can never be overwritten
      try {
        await link(tmp, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new VaultFsError("A file already exists at that path");
        throw e;
      }
      await unlink(tmp);
    } else {
      await rename(tmp, target);
    }
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function readText(p: string) {
  return readFile(p, "utf8");
}

/** Read, transform, and write back only if nobody changed the file in between (Obsidian may be saving at the same time). */
export async function editFileSafely(abs: string, transform: (text: string) => string, retries = 3): Promise<{ before: string; after: string } | null> {
  for (let i = 0; i < retries; i++) {
    const before = await readFile(abs, "utf8");
    const after = transform(before);
    if (after === before) return { before, after };
    const s1 = await stat(abs);
    const tmp = join(dirname(abs), `.${randomBytes(6).toString("hex")}.bridge-tmp`);
    const fh = await open(tmp, "wx", s1.mode & 0o777);
    try {
      await fh.writeFile(after);
      await fh.sync();
    } finally {
      await fh.close();
    }
    const now = await readFile(abs, "utf8").catch(() => null);
    if (now === before) {
      await rename(tmp, abs);
      return { before, after };
    }
    await rm(tmp, { force: true });
  }
  return null;
}

/** Entries to leave alone when walking the vault: hidden names (.obsidian, .trash, .git ...). */
export const isHidden = (name: string) => name.startsWith(".");

export type WalkEntry = { abs: string; rel: string; name: string; size: number; mtimeMs: number };

/** All regular files in the vault (no hidden folders, no symlinks), as vault-relative paths. */
export async function walkVault(root: string, onDir?: (rel: string) => void): Promise<WalkEntry[]> {
  const rootReal = await realpath(root);
  const out: WalkEntry[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow links: they could point outside the vault
      if (e.isDirectory()) {
        onDir?.(relative(rootReal, abs).split(sep).join("/"));
        await visit(abs);
      } else if (e.isFile()) {
        const s = await stat(abs);
        out.push({ abs, rel: relative(rootReal, abs).split(sep).join("/"), name: e.name, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  await visit(rootReal);
  return out;
}

