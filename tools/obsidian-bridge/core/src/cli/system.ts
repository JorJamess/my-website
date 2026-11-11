import { execFile } from "node:child_process";
import { access, constants, statfs } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string };

export const nodeOk = () => {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 5);
};

/** FileVault covers the Mac's main disk. Returns null if it could not be determined. */
export async function fileVaultOn(): Promise<boolean | null> {
  try {
    const { stdout } = await run("fdesetup", ["status"]);
    return /FileVault is On/i.test(stdout);
  } catch {
    return null;
  }
}

/** Whether the volume that holds `path` is encrypted (APFS Encrypted / FileVault). null = unknown. */
export async function volumeEncrypted(path: string): Promise<boolean | null> {
  try {
    const { stdout } = await run("diskutil", ["info", path]);
    if (/Not a mount point|Could not find disk/i.test(stdout)) return null;
    const line = stdout.split("\n").find((l) => /^\s*(FileVault|Encrypted):/i.test(l));
    return line ? /Yes/i.test(line) : null;
  } catch {
    return null;
  }
}

export async function canReadWrite(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
