// Machine-readable setup steps for the Menu Bar app's Setup Wizard. The app holds no business logic: every check and
// action below is the same code the command line uses, and each step prints one JSON object.
import { existsSync } from "node:fs";
import { relative, isAbsolute, resolve } from "node:path";
import { hostname } from "node:os";
import { MacVolumes } from "../backup/volumes.js";
import { BridgeClient, ApiError, type FetchLike } from "../cloudflare/client.js";
import { ConfigError, isVault, loadConfig, paths, saveConfig, type BridgeConfig } from "../config/config.js";
import type { CredentialStore } from "../security/keychain.js";
import { callService } from "../service/ipc.js";
import { previewInitialSync } from "../sync/preview.js";
import { walkVault } from "../vault/fs-safe.js";
import { canReadWrite, fileVaultOn, freeBytes, nodeOk, volumeEncrypted } from "./system.js";

export type WizardDeps = { credentials: CredentialStore; fetch?: FetchLike; pdfHelper: string; version: string };
export type WizardFlags = Record<string, string | true>;

const str = (f: WizardFlags, k: string) => (typeof f[k] === "string" ? (f[k] as string) : undefined);
const need = (f: WizardFlags, k: string) => {
  const v = str(f, k);
  if (!v) throw new Error(`Missing --${k}`);
  return v;
};

export async function runWizard(step: string, flags: WizardFlags, deps: WizardDeps): Promise<Record<string, unknown>> {
  switch (step) {
    case "system": {
      const live = await callService(paths().socket, "status", {}, 1500);
      const cfg = await loadConfig().catch(() => null);
      return {
        node: { ok: nodeOk(), version: process.versions.node },
        fileVault: await fileVaultOn(),
        pdfReader: existsSync(deps.pdfHelper),
        configured: !!cfg,
        paired: !!(cfg?.deviceId && (await deps.credentials.get(cfg.deviceId))),
        initialSyncConfirmed: !!cfg?.initialSyncConfirmedAt,
        serviceRunning: !!live?.ok,
        version: deps.version,
      };
    }
    case "check-vault": {
      const p = resolve(need(flags, "path"));
      const valid = await isVault(p);
      const rw = valid ? await canReadWrite(p) : false;
      let markdown = 0;
      let bytes = 0;
      if (valid && rw) for (const f of await walkVault(p)) (bytes += f.size, /\.md$/i.test(f.name) && markdown++);
      return { path: p, valid, readWrite: rw, name: p.split("/").pop(), markdownFiles: markdown, sizeBytes: bytes };
    }
    case "check-backup": {
      const p = resolve(need(flags, "path"));
      const vault = str(flags, "vault");
      const rel = vault ? relative(resolve(vault), p) : "x";
      const insideVault = !!vault && (!rel || (!rel.startsWith("..") && !isAbsolute(rel)));
      const rw = await canReadWrite(p);
      let vaultBytes = 0;
      if (vault && (await isVault(vault))) for (const f of await walkVault(vault)) vaultBytes += f.size;
      const free = rw ? await freeBytes(p) : null;
      return { path: p, writable: rw, insideVault, freeBytes: free, vaultBytes, enoughSpace: free === null ? null : free >= vaultBytes * 3, encrypted: rw ? await volumeEncrypted(p) : null };
    }
    case "check-external": {
      const p = resolve(need(flags, "path"));
      const rw = await canReadWrite(p);
      const info = rw ? await new MacVolumes().info(p) : null;
      return { path: p, available: rw, writable: rw, volumeUuid: info?.uuid ?? null, volumeName: info?.name ?? null, encrypted: info?.encrypted ?? null, freeBytes: rw ? await freeBytes(p) : null };
    }
    case "pair": {
      const url = need(flags, "url").replace(/\/+$/, "");
      const vault = resolve(need(flags, "vault"));
      const backup = resolve(need(flags, "backup"));
      const ext = str(flags, "external") ? resolve(str(flags, "external")!) : null;
      if (!(await isVault(vault))) throw new Error("That folder is not an Obsidian vault");
      const info = ext ? await new MacVolumes().info(ext) : null;
      const name = str(flags, "name") ?? hostname();
      const prev = await loadConfig().catch(() => null);
      const vaultName = vault.split("/").pop() ?? "Vault";
      let deviceId = prev?.deviceId;
      if (!deviceId || !(await deps.credentials.get(deviceId)) || flags.code) {
        const res = await BridgeClient.pair(url, { code: need(flags, "code"), name, vault_name: vaultName, version: deps.version }, deps.fetch);
        if (deviceId) await deps.credentials.delete(deviceId);
        await deps.credentials.set(res.device_id, res.token);
        deviceId = res.device_id;
      }
      const cfg: BridgeConfig = {
        version: 1,
        lifeosUrl: url,
        vaultPath: vault,
        vaultName,
        deviceName: name,
        deviceId,
        backup: {
          localPath: backup,
          externalPath: ext,
          externalVolumeUuid: info?.uuid ?? null,
          externalSubpath: info?.mountPoint && ext ? relative(info.mountPoint, ext) : null,
          allowUnencrypted: flags["allow-unencrypted"] === true,
        },
        trashFolder: prev?.trashFolder ?? ".trash",
        pollSeconds: prev?.pollSeconds ?? 15,
        pdfMaxBytes: prev?.pdfMaxBytes ?? 100 * 1024 * 1024,
        initialSyncConfirmedAt: prev?.initialSyncConfirmedAt,
      };
      await saveConfig(cfg);
      return { paired: true, deviceId, vaultName };
    }
    case "preview": {
      const cfg = await loadConfig();
      return { ...(await previewInitialSync(cfg.vaultPath, { pdfMaxBytes: cfg.pdfMaxBytes })) };
    }
    case "confirm": {
      const live = await callService(paths().socket, "confirm-initial-sync", {}, 5000);
      if (!live) {
        const cfg = await loadConfig();
        await saveConfig({ ...cfg, initialSyncConfirmedAt: new Date().toISOString() });
      } else if (!live.ok) throw new Error(live.error);
      return { confirmed: true };
    }
    case "state": {
      const cfg = await loadConfig();
      return { vaultPath: cfg.vaultPath, vaultName: cfg.vaultName, lifeosUrl: cfg.lifeosUrl, deviceName: cfg.deviceName, paired: !!cfg.deviceId, backupLocal: cfg.backup.localPath, backupExternal: cfg.backup.externalPath, initialSyncConfirmed: !!cfg.initialSyncConfirmedAt, pollSeconds: cfg.pollSeconds, home: paths().home, log: paths().log, socket: paths().socket };
    }
    default:
      throw new Error(`Unknown wizard step: ${step}`);
  }
}

export const wizardError = (e: unknown) => (e instanceof ConfigError || e instanceof ApiError || e instanceof Error ? e.message : String(e));
