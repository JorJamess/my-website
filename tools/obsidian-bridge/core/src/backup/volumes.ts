import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export type VolumeInfo = { uuid: string | null; mountPoint: string | null; name: string | null; encrypted: boolean | null };

/** What the backup code needs to know about drives. Real macOS implementation below; tests supply a fake. */
export interface VolumeProvider {
  info(path: string): Promise<VolumeInfo>;
  /** the folder where the volume with this UUID is mounted right now, or null when it is not connected */
  findByUuid(uuid: string): Promise<string | null>;
}

function parse(text: string): VolumeInfo {
  const get = (re: RegExp) => re.exec(text)?.[1]?.trim() || null;
  const enc = /^\s*(?:FileVault|Encrypted):\s*(\S+)/im.exec(text)?.[1];
  return { uuid: get(/^\s*Volume UUID:\s*(.+)$/im), mountPoint: get(/^\s*Mount Point:\s*(.+)$/im), name: get(/^\s*Volume Name:\s*(.+)$/im), encrypted: enc === undefined ? null : /^yes$/i.test(enc) };
}

export class MacVolumes implements VolumeProvider {
  async info(path: string): Promise<VolumeInfo> {
    try {
      const { stdout } = await run("diskutil", ["info", path]);
      return parse(stdout);
    } catch {
      return { uuid: null, mountPoint: null, name: null, encrypted: null };
    }
  }
  async findByUuid(uuid: string): Promise<string | null> {
    for (const name of await readdir("/Volumes").catch(() => [] as string[])) {
      const i = await this.info(`/Volumes/${name}`);
      if (i.uuid === uuid) return i.mountPoint ?? `/Volumes/${name}`;
    }
    return null;
  }
}

export { parse as parseDiskutil };
