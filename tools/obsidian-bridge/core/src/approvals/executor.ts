import { link, lstat, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { scanForSecrets } from "../shared/secrets.js";
import type { ClaimedCommand, CommandResultBody } from "../cloudflare/client.js";
import type { BridgeConfig } from "../config/config.js";
import type { Logger } from "../logging.js";
import { atomicWrite, editFileSafely, exists, readText, resolveInVault, VaultFsError, walkVault } from "../vault/fs-safe.js";
import { parseNote, replaceBody, setFrontmatterKey, UUID_RE } from "../vault/frontmatter.js";
import { IMAGE_EXT } from "../vault/links.js";
import { sha256 } from "../vault/scan.js";
import { lineDiff } from "./diff.js";

export type SafetyBackup = (reason: string) => Promise<{ ok: boolean; message?: string }>;
export type ExecDeps = { cfg: BridgeConfig; log: Logger; safetyBackup: SafetyBackup; now?: () => number };

class Refuse extends Error {}
class Conflict extends Error {
  constructor(public diff: string, public currentHash: string) {
    super("changed");
  }
}

/** Backup that refuses to run: used until the backup system is configured, so nothing destructive can happen unprotected. */
export const noBackupConfigured: SafetyBackup = async () => ({ ok: false, message: "Backups are not set up on this Mac yet" });

const needsBackup = new Set(["edit_note", "rename_note", "move_note", "delete_note", "rename_folder", "move_folder", "delete_folder"]);

const str = (p: Record<string, unknown>, k: string) => {
  const v = p[k];
  if (typeof v !== "string") throw new Refuse(`${k} is missing`);
  return v;
};

/** Count what a folder holds without naming anything: used in results and before deleting. */
export async function folderImpact(root: string, relFolder: string) {
  const { abs, rootReal } = await resolveInVault(root, relFolder, { kind: "folder", mustExist: true });
  const files = (await walkVault(abs)).map((f) => f.name.toLowerCase());
  void rootReal;
  const ext = (n: string) => n.slice(n.lastIndexOf(".") + 1);
  const notes = files.filter((n) => n.endsWith(".md")).length;
  const pdfs = files.filter((n) => n.endsWith(".pdf")).length;
  const images = files.filter((n) => IMAGE_EXT.has(ext(n))).length;
  return { notes, pdfs, images, other: files.length - notes - pdfs - images, total: files.length };
}

/** Move something into the vault's trash folder under a name that does not exist yet. Never deletes. */
async function toTrash(cfg: BridgeConfig, abs: string): Promise<string> {
  const trash = join(cfg.vaultPath, cfg.trashFolder);
  await mkdir(trash, { recursive: true });
  const name = basename(abs);
  let target = join(trash, name);
  if (await exists(target)) {
    const dot = name.lastIndexOf(".");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    target = join(trash, dot > 0 && (await stat(abs)).isFile() ? `${name.slice(0, dot)} ${stamp}${name.slice(dot)}` : `${name} ${stamp}`);
  }
  await rename(abs, target);
  return target;
}

/** Move a file without ever replacing an existing one (hard link fails if the target exists). */
async function moveFileNoClobber(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await link(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Refuse("Something already exists at the new path. Ask for a different name or folder.");
    throw e;
  }
  await unlink(from);
}

async function moveFolderNoClobber(from: string, to: string) {
  if (await exists(to)) throw new Refuse("Something already exists at the new path. Ask for a different name or folder.");
  if (to === from || to.startsWith(from + sep)) throw new Refuse("A folder can't be moved inside itself");
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
}

const ok = (message: string): CommandResultBody => ({ status: "applied", message });

/**
 * Apply one approved change to the vault. Checks, in order: not expired, path safe, nothing already in the way,
 * file unchanged since the proposal, safety backup done. Any problem stops it without touching anything.
 */
export async function executeCommand(cmd: ClaimedCommand, deps: ExecDeps): Promise<CommandResultBody> {
  const { cfg, log } = deps;
  const now = deps.now?.() ?? Date.now();
  if (Date.parse(cmd.expires_at) <= now) return { status: "failed", message: "Expired before the Mac could apply it. Ask Claude again." };
  const p = cmd.payload;
  try {
    const kind = cmd.op.endsWith("_folder") ? "folder" : "note";
    const src = cmd.op !== "create_note" && cmd.op !== "create_folder" ? await resolveInVault(cfg.vaultPath, str(p, "path"), { kind, mustExist: true }) : null;
    if (src) {
      const s = await lstat(src.abs);
      if (kind === "note" ? !s.isFile() : !s.isDirectory()) throw new Refuse(kind === "note" ? "That path is not a note" : "That path is not a folder");
    }
    const dest = ["rename_note", "move_note", "rename_folder", "move_folder"].includes(cmd.op) ? await resolveInVault(cfg.vaultPath, str(p, "new_path"), { kind }) : null;

    // conflict check before anything else changes
    const expected = typeof p.expected_hash === "string" ? p.expected_hash : cmd.expected_hash;
    if (src && kind === "note" && (cmd.op === "edit_note" || expected)) {
      const current = await readText(src.abs);
      if (!expected || sha256(current) !== expected) {
        const proposed = cmd.op === "edit_note" ? bodyOf(str(p, "new_content")) : null;
        return { status: "conflict", message: "The note changed on the Mac after the proposal", conflict: { current_hash: sha256(current), diff: proposed === null ? null : lineDiff(parseNote(current).body, proposed) } };
      }
    }

    if (needsBackup.has(cmd.op)) {
      const b = await deps.safetyBackup(cmd.op);
      if (!b.ok) return { status: "failed", message: `Safety backup failed, nothing was changed${b.message ? ` (${b.message})` : ""}`.slice(0, 200) };
    }

    switch (cmd.op) {
      case "create_note": {
        const target = await resolveInVault(cfg.vaultPath, str(p, "path"), { kind: "note" });
        if (await exists(target.abs)) throw new Refuse("A note already exists at that path. Ask Claude to pick another name or folder.");
        let text = str(p, "content");
        const parsed = parseNote(text);
        if (!parsed.id || !UUID_RE.test(parsed.id)) text = setFrontmatterKey(text, "id", randomUUID());
        text = setFrontmatterKey(text, "lifeos_sync", "true");
        await atomicWrite(target.abs, text, { exclusive: true });
        const blocked = scanForSecrets(text).length > 0;
        log.info("created note", { path: target.rel });
        return ok(blocked ? "Note created. Cloud sync is blocked because it may contain a secret." : "Note created");
      }
      case "edit_note": {
        const body = bodyOf(str(p, "new_content"));
        let conflict: Conflict | null = null;
        const done = await editFileSafely(src!.abs, (t) => {
          if (sha256(t) !== expected) {
            conflict = new Conflict(lineDiff(parseNote(t).body, body), sha256(t));
            return t;
          }
          return replaceBody(t, body);
        });
        if (conflict || !done) {
          const c = conflict as Conflict | null;
          return { status: "conflict", message: "The note changed on the Mac while applying", conflict: { current_hash: c?.currentHash ?? null, diff: c?.diff ?? null } };
        }
        log.info("edited note", { path: src!.rel });
        return ok(scanForSecrets(done.after).length ? "Note edited. Cloud sync is blocked because it may contain a secret." : "Note edited");
      }
      case "rename_note":
      case "move_note":
        await moveFileNoClobber(src!.abs, dest!.abs);
        return ok(cmd.op === "rename_note" ? "Note renamed" : "Note moved");
      case "delete_note":
        await toTrash(cfg, src!.abs);
        return ok("Note moved to the Obsidian trash");
      case "create_folder": {
        const target = await resolveInVault(cfg.vaultPath, str(p, "path"), { kind: "folder" });
        if (await exists(target.abs)) throw new Refuse("A folder or file already exists at that path");
        await mkdir(target.abs, { recursive: true });
        return ok("Folder created");
      }
      case "rename_folder":
      case "move_folder":
        await moveFolderNoClobber(src!.abs, dest!.abs);
        return ok(cmd.op === "rename_folder" ? "Folder renamed" : "Folder moved");
      case "delete_folder": {
        const impact = await folderImpact(cfg.vaultPath, src!.rel);
        await toTrash(cfg, src!.abs);
        return ok(`Folder moved to the Obsidian trash (${impact.notes} notes, ${impact.pdfs} PDFs, ${impact.images} images, ${impact.other} other files)`);
      }
      default:
        return { status: "failed", message: "This version of the Bridge doesn't know that operation" };
    }
  } catch (e) {
    if (e instanceof Refuse || e instanceof VaultFsError) return { status: "failed", message: e.message.slice(0, 200) };
    log.error("command failed", { op: cmd.op, error: (e as Error).message });
    return { status: "failed", message: "Unexpected error. Nothing was changed if the file was not touched; check Obsidian." };
  }
}

/** Claude sees the note body without frontmatter, so a proposal's text replaces the body only. */
function bodyOf(text: string) {
  const p = parseNote(text);
  return p.hasFrontmatter ? p.body : text;
}

