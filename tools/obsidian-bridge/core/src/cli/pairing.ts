// The one place where a Mac gets paired and its config written. Setup, `pair` and the Menu Bar app's wizard all use it,
// so they validate the same things and fail the same safe way.
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { MacVolumes } from "../backup/volumes.js";
import { BridgeClient, type FetchLike } from "../cloudflare/client.js";
import { isVault, saveConfig, type BridgeConfig } from "../config/config.js";
import type { CredentialStore } from "../security/keychain.js";

export type PairInput = {
  url: string;
  /** a one-time code from LifeOS; omit to keep the existing pairing */
  code?: string;
  name: string;
  vault: string;
  backup: string | null;
  external: string | null;
  allowUnencrypted: boolean;
  version: string;
};

export const insideOrSame = (child: string, parent: string) => {
  const rel = relative(resolve(parent), resolve(child));
  return !rel || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
};

/** The real location of a path, following symlinks; a folder that does not exist yet is resolved through its nearest existing parent. */
async function realish(p: string): Promise<string> {
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(await realish(parent), abs.slice(parent.length + 1));
  }
}

/** Folder rules that protect the vault and the backups: a real vault, and backup folders (local and external) that are not inside it. */
export async function validateFolders(vault: string, backup: string | null, external: string | null = null) {
  if (!(await isVault(vault))) throw new Error("That folder is not an Obsidian vault (no .obsidian folder inside).");
  const v = await realish(vault);
  if (backup && insideOrSame(await realish(backup), v)) throw new Error("The backup folder can't be inside the vault.");
  if (external && insideOrSame(await realish(external), v)) throw new Error("The external backup folder can't be inside the vault.");
}

export async function buildConfig(prev: BridgeConfig | null, i: PairInput, deviceId: string | undefined): Promise<BridgeConfig> {
  const vaultPath = resolve(i.vault);
  const ext = i.external ? resolve(i.external) : null;
  const info = ext ? await new MacVolumes().info(ext) : null;
  const url = i.url.replace(/\/+$/, "");
  // an earlier confirmation only carries over for the same vault and the same LifeOS: anything else needs a fresh review
  const sameTarget = !!prev && prev.vaultPath === vaultPath && prev.lifeosUrl === url;
  return {
    version: 1,
    lifeosUrl: url,
    vaultPath,
    vaultName: vaultPath.split("/").pop() ?? "Vault",
    deviceName: i.name,
    deviceId,
    backup: {
      localPath: i.backup ? resolve(i.backup) : null,
      externalPath: ext,
      externalVolumeUuid: info?.uuid ?? null,
      externalSubpath: info?.mountPoint && ext ? relative(info.mountPoint, ext) : null,
      allowUnencrypted: i.allowUnencrypted,
    },
    trashFolder: prev?.trashFolder ?? ".trash",
    pollSeconds: prev?.pollSeconds ?? 15,
    pdfMaxBytes: prev?.pdfMaxBytes ?? 100 * 1024 * 1024,
    initialSyncConfirmedAt: sameTarget ? prev?.initialSyncConfirmedAt : undefined,
  };
}

/**
 * Validate, pair (if a code is given), then save the config. The new token is stored before anything old is removed, and
 * the old token is deleted only after the new config was written, so a failure never leaves the Mac unpaired.
 */
export async function pairAndSave(deps: { credentials: CredentialStore; fetch?: FetchLike }, prev: BridgeConfig | null, i: PairInput) {
  await validateFolders(resolve(i.vault), i.backup, i.external);
  const oldId = prev?.deviceId;
  let deviceId = oldId;
  let created = false;
  if (i.code || !oldId || !(await deps.credentials.get(oldId))) {
    if (!i.code) throw new Error("A pairing code is needed to pair this Mac.");
    const res = await BridgeClient.pair(i.url.replace(/\/+$/, ""), { code: i.code, name: i.name, vault_name: resolve(i.vault).split("/").pop(), version: i.version }, deps.fetch);
    await deps.credentials.set(res.device_id, res.token);
    deviceId = res.device_id;
    created = true;
  }
  const cfg = await buildConfig(prev, i, deviceId);
  try {
    await saveConfig(cfg);
  } catch (e) {
    if (created && deviceId) await deps.credentials.delete(deviceId).catch(() => {});
    throw e;
  }
  if (created && oldId && oldId !== deviceId) await deps.credentials.delete(oldId).catch(() => {});
  return { deviceId: deviceId!, vaultName: cfg.vaultName, repaired: created };
}
