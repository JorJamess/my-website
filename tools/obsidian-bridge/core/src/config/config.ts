import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export class ConfigError extends Error {}

export type BridgeConfig = {
  version: 1;
  lifeosUrl: string;
  vaultPath: string;
  vaultName: string;
  deviceName: string;
  deviceId?: string;
  backup: {
    localPath: string | null;
    externalPath: string | null;
    /** the external drive is found by this id, so it works whichever name or path macOS gives it */
    externalVolumeUuid?: string | null;
    /** folder on that drive */
    externalSubpath?: string | null;
    /** the owner accepted backing up to a drive that is not encrypted */
    allowUnencrypted?: boolean;
  };
  /** Obsidian's trash folder inside the vault (deleted items are moved here, never removed) */
  trashFolder: string;
  pollSeconds: number;
  pdfMaxBytes: number;
  /** set after the owner reviewed the initial sync preview and said yes */
  initialSyncConfirmedAt?: string;
  paused?: boolean;
};

export const SERVICE_NAME = "com.jameswebpupu.obsidian-bridge";

/** Where the Bridge keeps its files. Secrets are NOT stored here (they live in the macOS Keychain). */
export function homeDir() {
  return process.env.OBSIDIAN_BRIDGE_HOME ?? join(homedir(), "Library", "Application Support", "ObsidianBridge");
}
export const paths = (home = homeDir()) => ({
  home,
  config: join(home, "config.json"),
  state: join(home, "state.json"),
  socket: join(home, "bridge.sock"),
  logDir: join(home, "logs"),
  log: join(home, "logs", "bridge.log"),
});

export function validateConfig(raw: unknown): BridgeConfig {
  const r = raw as Record<string, unknown> | null;
  const bad = (m: string) => {
    throw new ConfigError(m);
  };
  if (!r || typeof r !== "object") return bad("Config is not an object");
  const str = (k: string, opts: { optional?: boolean } = {}) => {
    const v = r[k];
    if (v === undefined && opts.optional) return undefined;
    if (typeof v !== "string" || !v.trim()) bad(`Config: "${k}" must be a non-empty string`);
    return (v as string).trim();
  };
  if (r.version !== 1) bad("Config: unsupported version");
  const lifeosUrl = str("lifeosUrl")!;
  try {
    const u = new URL(lifeosUrl);
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) bad("Config: lifeosUrl must be https (http is only allowed for localhost)");
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    bad("Config: lifeosUrl is not a valid URL");
  }
  const vaultPath = str("vaultPath")!;
  if (!isAbsolute(vaultPath)) bad("Config: vaultPath must be an absolute path");
  const backup = (r.backup ?? {}) as Record<string, unknown>;
  const optPath = (k: string) => {
    const v = backup[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || !isAbsolute(v)) bad(`Config: backup.${k} must be an absolute path or null`);
    return v as string;
  };
  const pollSeconds = r.pollSeconds === undefined ? 15 : Number(r.pollSeconds);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 5 || pollSeconds > 3600) bad("Config: pollSeconds must be between 5 and 3600");
  const pdfMax = r.pdfMaxBytes === undefined ? 100 * 1024 * 1024 : Number(r.pdfMaxBytes);
  if (!Number.isFinite(pdfMax) || pdfMax < 1024 || pdfMax > 100 * 1024 * 1024) bad("Config: pdfMaxBytes must be at most 100 MB");
  const trash = r.trashFolder === undefined ? ".trash" : str("trashFolder")!;
  if (!/^\.?[A-Za-z0-9 _-]+$/.test(trash)) bad("Config: trashFolder must be a simple folder name");
  return {
    version: 1,
    lifeosUrl: lifeosUrl.replace(/\/+$/, ""),
    vaultPath,
    vaultName: str("vaultName")!,
    deviceName: str("deviceName")!,
    deviceId: str("deviceId", { optional: true }),
    backup: {
      localPath: optPath("localPath"),
      externalPath: optPath("externalPath"),
      externalVolumeUuid: typeof backup.externalVolumeUuid === "string" && backup.externalVolumeUuid ? backup.externalVolumeUuid : null,
      externalSubpath: typeof backup.externalSubpath === "string" ? backup.externalSubpath : null,
      allowUnencrypted: backup.allowUnencrypted === true,
    },
    trashFolder: trash,
    pollSeconds,
    pdfMaxBytes: pdfMax,
    initialSyncConfirmedAt: typeof r.initialSyncConfirmedAt === "string" ? r.initialSyncConfirmedAt : undefined,
    paused: r.paused === true,
  };
}

export async function loadConfig(file = paths().config): Promise<BridgeConfig> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new ConfigError("Not set up yet. Run: obsidian-bridge setup");
  }
  try {
    return validateConfig(JSON.parse(text));
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError("Config file is damaged (not valid JSON)");
  }
}

/** Private to the user (0600). Written atomically. */
export async function saveConfig(cfg: BridgeConfig, file = paths().config) {
  const clean = validateConfig(cfg);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export async function isVault(dir: string): Promise<boolean> {
  const s = await stat(join(dir, ".obsidian")).catch(() => null);
  return !!s?.isDirectory();
}
