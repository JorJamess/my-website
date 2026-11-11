#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { hostname } from "node:os";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient, ApiError } from "../cloudflare/client.js";
import { ConfigError, isVault, loadConfig, paths, saveConfig, type BridgeConfig } from "../config/config.js";
import { fileLogger } from "../logging.js";
import { createPdfExtractor } from "../pdf/extract.js";
import { MacKeychain } from "../security/keychain.js";
import { BridgeService } from "../service/daemon.js";
import { callService } from "../service/ipc.js";
import { syncVault, SyncNotConfirmedError } from "../sync/engine.js";
import { previewInitialSync, type InitialPreview } from "../sync/preview.js";
import { loadState, saveState } from "../sync/state.js";
import { walkVault } from "../vault/fs-safe.js";
import { canReadWrite, fileVaultOn, fmtBytes, freeBytes, nodeOk, volumeEncrypted, type Check } from "./system.js";

const VERSION = "0.1.0";
const here = dirname(fileURLToPath(import.meta.url));
const helperPath = () => process.env.OBSIDIAN_BRIDGE_PDF_HELPER ?? [join(here, "../../native/bin/pdf-text"), join(here, "../native/bin/pdf-text")].find(existsSync) ?? join(here, "../../native/bin/pdf-text");

const HELP: Record<string, string> = {
  setup: "obsidian-bridge setup [--vault <dir>] [--backup <dir>] [--external <dir>] [--url <https://...>] [--code <pairing code>] [--name <device name>] [--yes]\n  Guided setup: choose your vault and backup folders, check disk encryption, pair this Mac with LifeOS and preview the first sync.\n  Nothing is uploaded until you confirm the preview.",
  status: "obsidian-bridge status [--json]\n  Shows whether the Bridge is running, the last sync, notes by state, pending commands and today's request count.",
  doctor: "obsidian-bridge doctor\n  Checks Node, the vault, permissions, FileVault, backup folders, the PDF reader, the pairing and the connection to LifeOS.",
  sync: "obsidian-bridge sync [--confirm-initial]\n  Syncs now. The very first sync needs --confirm-initial after you reviewed the preview.",
  pause: "obsidian-bridge pause\n  Stops syncing and applying approved changes until you run resume. Revocations from LifeOS are still applied.",
  resume: "obsidian-bridge resume\n  Starts syncing again.",
  backup: "obsidian-bridge backup [list]\n  Vault backups. (Arrives in the backup phase; not available yet.)",
  restore: "obsidian-bridge restore [preview]\n  Restore from a backup. (Arrives in the backup phase; not available yet.)",
  logs: "obsidian-bridge logs [-n <lines>]\n  Prints the last lines of the Bridge log (default 50). Logs never contain note text or secrets.",
  pair: "obsidian-bridge pair [--code <code>]\n  Pairs this Mac with LifeOS using a one-time code from Settings → Obsidian. The device token goes into the macOS Keychain.",
  unpair: "obsidian-bridge unpair\n  Tells LifeOS to forget this Mac and removes the token from the Keychain.",
  reenable: "obsidian-bridge reenable <note id>\n  Re-enables a note you revoked. It is scanned again for secrets before anything is uploaded.",
  run: "obsidian-bridge run\n  Runs the Bridge service in the foreground (the LaunchAgent uses this). Stop with Ctrl-C.",
  version: "obsidian-bridge version\n  Prints the version.",
};

function parseArgs(argv: string[]) {
  const words: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("-") && !["yes", "json", "help", "confirm-initial"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === "-n" && argv[i + 1]) flags.n = argv[++i];
    else if (a === "-h") flags.help = true;
    else words.push(a);
  }
  return { words, flags };
}

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");
const mark = { ok: "✓", warn: "!", fail: "✗" } as const;

async function ask(rl: ReturnType<typeof createInterface> | null, q: string, preset?: string | true, fallback?: string): Promise<string> {
  if (typeof preset === "string") return preset;
  if (!rl) throw new Error(`Missing a value for: ${q}. Pass it as a flag (see: obsidian-bridge help setup).`);
  const a = (await rl.question(fallback ? `${q} [${fallback}]: ` : `${q}: `)).trim();
  return a || fallback || "";
}
const yes = async (rl: ReturnType<typeof createInterface> | null, q: string, auto: boolean) => (auto ? true : rl ? /^y(es)?$/i.test((await rl.question(`${q} (yes/no): `)).trim()) : false);

function printPreview(p: InitialPreview) {
  out("\nWhat the first sync would send (numbers only; local-only notes are never named):");
  out(`  Markdown files in the vault      ${p.markdownFiles}`);
  out(`  Notes marked lifeos_sync: true   ${p.eligibleNotes}`);
  out(`    already have an id             ${p.notesWithId}`);
  out(`    need a new id (added on sync)  ${p.notesNeedingId}`);
  out(`    invalid ids                    ${p.invalidIds}`);
  out(`    duplicate id groups            ${p.duplicateIdGroups}`);
  out(`  Referenced PDFs (text only)      ${p.referencedPdfs}`);
  out(`    over the size limit            ${p.pdfsTooLarge}`);
  out(`    not found / unsupported        ${p.pdfsNotFound}`);
  out(`  Held back by the secret scan     ${p.blockedBySecretScan}`);
  out(`  Estimated text to upload         ${fmtBytes(p.estimatedTextBytes)}`);
  if (p.unreadable) out(`  Unreadable files                 ${p.unreadable}`);
  if (p.ambiguousFlags) out(`  Notes with an unclear flag       ${p.ambiguousFlags} (only the exact value true shares a note)`);
  out("  Images and PDF files themselves never leave this Mac.");
}

async function setup(flags: Record<string, string | true>) {
  const interactive = process.stdin.isTTY && !flags.yes;
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    out("Obsidian Bridge setup\n");
    if (!nodeOk()) throw new Error(`Node ${process.versions.node} is too old. Install Node 22.5 or newer.`);
    const p = paths();
    const prev = await loadConfig().catch(() => null);

    const vaultPath = resolve(await ask(rl, "Path to your Obsidian vault folder", flags.vault, prev?.vaultPath));
    if (!(await isVault(vaultPath))) throw new Error("That folder is not an Obsidian vault (no .obsidian folder inside).");
    if (!(await canReadWrite(vaultPath))) throw new Error("The Bridge can't read and write that folder. Check macOS permissions (System Settings → Privacy & Security → Files and Folders).");
    out(`  ✓ Vault found and readable`);

    const backupPath = resolve(await ask(rl, "Folder for local backups (outside the vault)", flags.backup, prev?.backup.localPath ?? undefined));
    const rel = relative(vaultPath, backupPath);
    if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("The backup folder can't be inside the vault.");
    if (!(await canReadWrite(backupPath))) throw new Error("The Bridge can't write to the backup folder. Create it first, or pick another.");
    let vaultSize = 0;
    for (const f of await walkVault(vaultPath)) vaultSize += f.size;
    const free = await freeBytes(backupPath);
    out(`  ✓ Backup folder is writable${free !== null ? ` (${fmtBytes(free)} free, vault is about ${fmtBytes(vaultSize)})` : ""}`);
    if (free !== null && free < vaultSize * 3) out(`  ! Free space is under three times the vault size; the daily backups may not fit.`);

    const extRaw = typeof flags.external === "string" ? flags.external : rl ? (await rl.question("External SSD backup folder (Enter to skip, add later): ")).trim() : "";
    const externalPath = extRaw ? resolve(extRaw) : null;
    if (externalPath && !(await canReadWrite(externalPath))) out("  ! The external folder isn't available right now. It will be skipped until the drive is connected.");

    const fv = await fileVaultOn();
    out(fv === true ? "  ✓ FileVault is on for this Mac" : fv === false ? "  ! FileVault is OFF. Backups on this Mac are not encrypted at rest. Turn it on in System Settings → Privacy & Security → FileVault." : "  ! Could not check FileVault");
    const encChecks: [string, boolean | null][] = [["backup folder", await volumeEncrypted(backupPath)]];
    if (externalPath) encChecks.push(["external drive", await volumeEncrypted(externalPath)]);
    let needAck = fv === false;
    for (const [name, enc] of encChecks) {
      if (enc === false) {
        out(`  ! The ${name} is not encrypted. Prefer APFS (Encrypted): Disk Utility → Erase → choose APFS (Encrypted). The Bridge never formats a drive.`);
        needAck = true;
      }
    }
    if (needAck && !(await yes(rl, "Continue without encryption on the items above?", flags.yes === true && flags["ack-no-encryption"] === true))) throw new Error("Stopped: enable encryption, or run setup again and accept the warning.");

    out(existsSync(helperPath()) ? "  ✓ PDF text reader is built" : "  ! PDF text reader is missing. Run: npm run build (notes sync, PDF text will not).");

    const url = (await ask(rl, "LifeOS address (https://...)", flags.url, prev?.lifeosUrl)).replace(/\/+$/, "");
    const deviceName = await ask(rl, "Name for this Mac", flags.name, prev?.deviceName ?? hostname());
    const cfg: BridgeConfig = {
      version: 1,
      lifeosUrl: url,
      vaultPath,
      vaultName: vaultPath.split("/").pop() ?? "Vault",
      deviceName,
      deviceId: prev?.deviceId,
      backup: { localPath: backupPath, externalPath },
      trashFolder: prev?.trashFolder ?? ".trash",
      pollSeconds: prev?.pollSeconds ?? 15,
      pdfMaxBytes: prev?.pdfMaxBytes ?? 100 * 1024 * 1024,
      initialSyncConfirmedAt: prev?.initialSyncConfirmedAt,
    };

    const keychain = new MacKeychain();
    if (!cfg.deviceId || !(await keychain.get(cfg.deviceId))) {
      out("\nIn LifeOS open Settings → Obsidian → Pair a Mac and copy the code.");
      const code = await ask(rl, "Pairing code", flags.code);
      const res = await BridgeClient.pair(url, { code, name: deviceName, vault_name: cfg.vaultName, version: VERSION });
      await keychain.set(res.device_id, res.token);
      cfg.deviceId = res.device_id;
      out("  ✓ Paired. The device token is stored in the macOS Keychain.");
    } else out("  ✓ Already paired");
    await saveConfig(cfg);

    const preview = await previewInitialSync(vaultPath, { pdfMaxBytes: cfg.pdfMaxBytes });
    printPreview(preview);
    if (cfg.initialSyncConfirmedAt) out("\nThe initial sync was already confirmed earlier.");
    else if (await yes(rl, "\nStart syncing these notes to LifeOS?", flags.yes === true && flags["confirm-initial"] === true)) {
      cfg.initialSyncConfirmedAt = new Date().toISOString();
      await saveConfig(cfg);
      out("  ✓ Initial sync confirmed.");
    } else out("\nNothing will be uploaded yet. When you are ready: obsidian-bridge sync --confirm-initial");
    out(`\nConfig saved in ${p.config}\nStart the service with: obsidian-bridge run   (or install it at login with scripts/install.sh)`);
  } finally {
    rl?.close();
    void interactive;
  }
}

async function loadAll() {
  const cfg = await loadConfig();
  const p = paths();
  return { cfg, p, state: await loadState(p.state) };
}

async function doctor() {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) => checks.push({ name, status, detail });
  add("Node", nodeOk() ? "ok" : "fail", process.versions.node);
  let cfg: BridgeConfig | null = null;
  try {
    cfg = await loadConfig();
    add("Config", "ok", paths().config);
  } catch (e) {
    add("Config", "fail", (e as Error).message);
  }
  if (cfg) {
    add("Vault", (await isVault(cfg.vaultPath)) ? "ok" : "fail", (await isVault(cfg.vaultPath)) ? "found" : "not an Obsidian vault or not reachable");
    add("Vault permissions", (await canReadWrite(cfg.vaultPath)) ? "ok" : "fail", "read and write");
    for (const [label, dir] of [["Local backup folder", cfg.backup.localPath], ["External backup folder", cfg.backup.externalPath]] as const) {
      if (!dir) {
        add(label, label.startsWith("External") ? "warn" : "fail", "not configured");
        continue;
      }
      const ok = await canReadWrite(dir);
      const free = ok ? await freeBytes(dir) : null;
      const enc = ok ? await volumeEncrypted(dir) : null;
      add(label, ok ? (enc === false ? "warn" : "ok") : label.startsWith("External") ? "warn" : "fail", ok ? `${free !== null ? fmtBytes(free) + " free; " : ""}${enc === true ? "encrypted" : enc === false ? "NOT encrypted" : "encryption unknown"}` : "not available");
    }
    const kc = cfg.deviceId ? await new MacKeychain().get(cfg.deviceId) : null;
    add("Pairing", kc ? "ok" : "fail", kc ? "device token in Keychain" : "not paired (run: obsidian-bridge pair)");
    try {
      const r = await fetch(`${cfg.lifeosUrl}/api/obsidian/bridge/poll`, { headers: { authorization: `Bearer ${kc ?? "none"}` }, signal: AbortSignal.timeout(10_000) });
      add("LifeOS connection", r.status === 200 ? "ok" : r.status === 401 ? "fail" : "warn", r.status === 200 ? "reachable and accepted" : r.status === 401 ? "reachable, but the token was refused (revoked?)" : `HTTP ${r.status}`);
    } catch (e) {
      add("LifeOS connection", "warn", `can't reach it (${(e as Error).message})`);
    }
    add("Initial sync", cfg.initialSyncConfirmedAt ? "ok" : "warn", cfg.initialSyncConfirmedAt ? "confirmed" : "not confirmed yet");
  }
  const fv = await fileVaultOn();
  add("FileVault", fv === true ? "ok" : fv === false ? "warn" : "warn", fv === true ? "on" : fv === false ? "OFF" : "unknown");
  add("PDF text reader", existsSync(helperPath()) ? "ok" : "warn", existsSync(helperPath()) ? helperPath() : "not built (npm run build)");
  const svc = await callService(paths().socket, "status", {}, 3000);
  add("Service", svc?.ok ? "ok" : "warn", svc?.ok ? "running" : "not running (obsidian-bridge run)");
  for (const c of checks) out(`${mark[c.status]} ${c.name.padEnd(24)} ${c.detail}`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

async function status(flags: Record<string, string | true>) {
  const live = await callService<Record<string, unknown>>(paths().socket, "status", {}, 5000);
  let cfg: BridgeConfig | null = null;
  try {
    cfg = await loadConfig();
  } catch (e) {
    out((e as Error).message);
    return 1;
  }
  const state = await loadState(paths().state);
  if (flags.json) {
    out(JSON.stringify({ running: !!live?.ok, live: live?.data ?? null, config: { vault: cfg.vaultName, lifeos: cfg.lifeosUrl, paired: !!cfg.deviceId }, lastSyncAt: state.lastSyncAt, lastError: state.lastError }, null, 2));
    return 0;
  }
  const s = live?.data as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  out(`Obsidian Bridge ${VERSION}`);
  out(`Service     ${live?.ok ? (s?.deviceRevoked ? "stopped: this Mac was revoked in LifeOS" : s?.paused ? "running (paused)" : s?.syncing ? "running (syncing)" : "running") : "not running"}`);
  out(`Vault       ${cfg.vaultName}`);
  out(`LifeOS      ${cfg.lifeosUrl} (${cfg.deviceId ? "paired" : "not paired"}${s ? `, ${s.online ? "online" : "offline"}` : ""})`);
  out(`Initial sync ${cfg.initialSyncConfirmedAt ? "confirmed " + cfg.initialSyncConfirmedAt : "not confirmed yet"}`);
  out(`Last sync   ${state.lastSuccessAt ?? "never"}${state.lastError ? `  (last problem: ${state.lastError})` : ""}`);
  const byStatus = Object.values(state.docs).reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  out(`Notes       ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  const pdfs = Object.values(state.pdfs).reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  out(`PDFs        ${Object.entries(pdfs).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  if (s) out(`Waiting     ${s.pendingCommands} approved change(s) for this Mac; ${s.usageToday.requests} requests today (${s.usageToday.polls} polls)`);
  out(`Backups     not available yet (next phase)`);
  return 0;
}

async function oneShotSync(confirmInitial: boolean) {
  const { cfg, p, state } = await loadAll();
  if (confirmInitial && !cfg.initialSyncConfirmedAt) {
    printPreview(await previewInitialSync(cfg.vaultPath, { pdfMaxBytes: cfg.pdfMaxBytes }));
    cfg.initialSyncConfirmedAt = new Date().toISOString();
    await saveConfig(cfg);
    out("\nInitial sync confirmed.");
  }
  const token = cfg.deviceId ? await new MacKeychain().get(cfg.deviceId) : null;
  if (!token) throw new Error("This Mac is not paired. Run: obsidian-bridge pair");
  const client = new BridgeClient(cfg.lifeosUrl, token);
  const report = await syncVault({ cfg, state, api: client, extractPdf: createPdfExtractor(helperPath(), { maxBytes: cfg.pdfMaxBytes }), log: fileLogger(p.log), persist: () => saveState(p.state, state) });
  await saveState(p.state, state);
  out(`Synced: ${report.uploaded} uploaded, ${report.pathUpdates} moved, ${report.removed} removed, ${report.unchanged} unchanged.`);
  const b = report.blocked;
  if (b.secret || b.revoked || b.duplicateId || b.invalidId) out(`Held back: ${b.secret} by the secret scan, ${b.revoked} revoked, ${b.duplicateId} duplicate ids, ${b.invalidId} invalid ids.`);
  for (const e of report.errors.slice(0, 5)) out(`  ! ${e}`);
  return report.errors.length ? 1 : 0;
}

async function run() {
  const { cfg, p, state } = await loadAll();
  const log = fileLogger(p.log, (l) => process.stdout.write(l + "\n"));
  const svc = new BridgeService({ cfg, configFile: p.config, stateFile: p.state, socketPath: p.socket, state, credentials: new MacKeychain(), extractPdf: createPdfExtractor(helperPath(), { maxBytes: cfg.pdfMaxBytes }), log });
  await svc.start();
  const quit = () => void svc.stop().then(() => process.exit(0));
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}

async function pair(flags: Record<string, string | true>, rl: ReturnType<typeof createInterface> | null) {
  const cfg = await loadConfig();
  const code = await ask(rl, "Pairing code from LifeOS (Settings → Obsidian)", flags.code);
  const res = await BridgeClient.pair(cfg.lifeosUrl, { code, name: cfg.deviceName, vault_name: cfg.vaultName, version: VERSION });
  const kc = new MacKeychain();
  if (cfg.deviceId) await kc.delete(cfg.deviceId);
  await kc.set(res.device_id, res.token);
  await saveConfig({ ...cfg, deviceId: res.device_id });
  out("Paired. Restart the service if it is running (obsidian-bridge run).");
}

async function unpair() {
  const cfg = await loadConfig();
  const kc = new MacKeychain();
  const token = cfg.deviceId ? await kc.get(cfg.deviceId) : null;
  if (token) await new BridgeClient(cfg.lifeosUrl, token).unpair().catch((e: unknown) => err(`LifeOS could not be told (${(e as Error).message}). Revoke this Mac in LifeOS Settings too.`));
  if (cfg.deviceId) await kc.delete(cfg.deviceId);
  await saveConfig({ ...cfg, deviceId: undefined });
  await callService(paths().socket, "shutdown", {}, 3000);
  out("Unpaired. This Mac no longer syncs. Your vault was not changed.");
}

export async function main(argv: string[]): Promise<number> {
  const { words, flags } = parseArgs(argv);
  const cmd = words[0];
  if (!cmd || cmd === "help" || (flags.help && !cmd)) {
    const topic = words[1];
    if (topic && HELP[topic]) out(HELP[topic]);
    else {
      out(`obsidian-bridge ${VERSION}: syncs selected Obsidian notes to LifeOS and applies changes you approved.\n`);
      for (const [k, v] of Object.entries(HELP)) out(`  ${v.split("\n")[0]}`.replace(/^ {2}obsidian-bridge /, `  ${k.padEnd(9)} `).replace(/\[.*$/, (m) => m));
      out("\nRun: obsidian-bridge help <command> for details.");
    }
    return 0;
  }
  if (flags.help) {
    out(HELP[cmd] ?? `Unknown command: ${cmd}`);
    return 0;
  }
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    switch (cmd) {
      case "version":
        out(VERSION);
        return 0;
      case "setup":
        rl?.close();
        await setup(flags);
        return 0;
      case "status":
        return await status(flags);
      case "doctor":
        return await doctor();
      case "sync": {
        const live = await callService(paths().socket, flags["confirm-initial"] ? "confirm-initial-sync" : "sync", {});
        if (live) {
          out(live.ok ? JSON.stringify(live.data, null, 2) : `Error: ${live.error}`);
          return live.ok ? 0 : 1;
        }
        return await oneShotSync(flags["confirm-initial"] === true);
      }
      case "pause":
      case "resume": {
        const live = await callService(paths().socket, cmd);
        if (live) return (out(live.ok ? (cmd === "pause" ? "Paused." : "Resumed.") : `Error: ${live.error}`), live.ok ? 0 : 1);
        const { p, state } = await loadAll();
        state.paused = cmd === "pause";
        await saveState(p.state, state);
        out(`${cmd === "pause" ? "Paused" : "Resumed"} (the service is not running; this applies when it starts).`);
        return 0;
      }
      case "backup":
      case "restore":
        err(`"${cmd}${words[1] ? " " + words[1] : ""}" is not available yet: vault backup and restore arrive in the next phase. Nothing was changed.`);
        return 2;
      case "logs": {
        const n = Math.min(Math.max(Number(flags.n ?? 50) || 50, 1), 1000);
        const text = await readFile(paths().log, "utf8").catch(() => "");
        out(text ? text.trimEnd().split("\n").slice(-n).join("\n") : "No log yet.");
        return 0;
      }
      case "pair":
        await pair(flags, rl);
        return 0;
      case "unpair":
        if (rl && !/^y(es)?$/i.test((await rl.question("Unpair this Mac from LifeOS? (yes/no): ")).trim())) return (out("Cancelled."), 1);
        await unpair();
        return 0;
      case "reenable": {
        const id = words[1];
        if (!id) return (err("Usage: obsidian-bridge reenable <note id>"), 1);
        if (rl && !/^y(es)?$/i.test((await rl.question("Re-enable cloud sync for this note? It is scanned again for secrets first. (yes/no): ")).trim())) return (out("Cancelled."), 1);
        const live = await callService(paths().socket, "reenable", { id });
        if (live) return (out(live.ok ? "Re-enabled. It syncs on the next pass." : `Error: ${live.error}`), live.ok ? 0 : 1);
        const cfg = await loadConfig();
        const token = cfg.deviceId ? await new MacKeychain().get(cfg.deviceId) : null;
        if (!token) throw new Error("This Mac is not paired.");
        const res = await new BridgeClient(cfg.lifeosUrl, token).reenable(id);
        out(`Re-enabled (permission version ${res.grant_version}). Start the service to sync it.`);
        return 0;
      }
      case "run":
        rl?.close();
        await run();
        return await new Promise<number>(() => {}); // keeps running until a signal
      default:
        err(`Unknown command: ${cmd}. Run: obsidian-bridge help`);
        return 1;
    }
  } catch (e) {
    if (e instanceof SyncNotConfirmedError) err("The first sync needs your confirmation: run obsidian-bridge sync --confirm-initial");
    else if (e instanceof ConfigError) err(e.message);
    else if (e instanceof ApiError) err(`LifeOS: ${e.message}`);
    else err(`Error: ${(e as Error).message}`);
    return 1;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

