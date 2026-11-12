import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AlreadyRunningError, BridgeService, NotPairedError, processStartTime } from "../src/service/daemon.js";
import { callService } from "../src/service/ipc.js";
import { MemoryCredentialStore } from "../src/security/keychain.js";
import { emptyState } from "../src/sync/state.js";
import { silentLogger } from "../src/logging.js";
import { loadConfig, saveConfig, validateConfig, ConfigError, type BridgeConfig } from "../src/config/config.js";
import { redact } from "../src/logging.js";
import { main, parseArgs } from "../src/cli/main.js";
import { createPdfExtractor } from "../src/pdf/extract.js";
import { ID, makeVault, NOTE, NATIVE } from "./helpers/vault.js";
import { BackupManager } from "../src/backup/manager.js";
import { listSnapshots } from "../src/backup/store.js";
import type { VolumeProvider } from "../src/backup/volumes.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const POLL = { now: "2026-01-01T00:00:00.000Z", cursor: "2026-01-01T00:00:00.000Z", paused: false, sync_requested: false, commands: [], revocations: [], exceptions: [] };

async function service(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, over: Partial<BridgeConfig> = {}) {
  const v = await makeVault();
  const home = await realpath(await mkdtemp(join(tmpdir(), "bh-")));
  cleanups.push(v.cleanup, () => rm(home, { recursive: true, force: true }));
  const creds = new MemoryCredentialStore();
  await creds.set("dev1", "token-token-token-token-1");
  const calls: string[] = [];
  const cfg: BridgeConfig = { version: 1, lifeosUrl: "https://x.test", vaultPath: v.dir, vaultName: "T", deviceName: "M", deviceId: "dev1", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8, initialSyncConfirmedAt: new Date().toISOString(), ...over };
  const svc = new BridgeService({
    cfg,
    configFile: join(home, "config.json"),
    stateFile: join(home, "state.json"),
    socketPath: join(home, "b.sock"),
    state: emptyState(),
    credentials: creds,
    extractPdf: createPdfExtractor(join(NATIVE, "pdf-text")),
    log: silentLogger,
    fetch:
      fetchImpl ??
      (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
        return Response.json(url.includes("/poll") ? POLL : { ok: true, id: "x", status: "synced", received: 0, expected: 0 });
      }),
    debounceMs: 20,
    reconcileEveryMs: 3_600_000,
    wakeCheckMs: 3_600_000,
  });
  await svc.start();
  cleanups.push(() => svc.stop());
  await new Promise((r) => setTimeout(r, 60));
  return { svc, v, home, calls, sock: join(home, "b.sock") };
}

describe("local control socket", () => {
  it("is private to the user and answers status, pause and resume", async () => {
    const { sock } = await service();
    expect((await stat(sock)).mode & 0o777).toBe(0o600);
    const st = await callService<{ running: boolean; paused: boolean; pollSeconds: number }>(sock, "status");
    expect(st).toMatchObject({ ok: true, data: { running: true, paused: false, pollSeconds: 15 } });
    expect((await callService<{ paused: boolean }>(sock, "pause"))!.data!.paused).toBe(true);
    expect((await callService<{ paused: boolean }>(sock, "resume"))!.data!.paused).toBe(false);
    expect((await callService(sock, "nonsense"))).toMatchObject({ ok: false });
    expect(await callService(sock + ".missing", "status", {}, 500)).toBeNull();
  });
  it("shows an initial sync preview as numbers only", async () => {
    const { sock, v } = await service();
    await v.write("a.md", NOTE(ID(1), true, "x"));
    await v.write("private name.md", "local");
    const r = await callService<{ eligibleNotes: number }>(sock, "preview");
    expect(r!.data!.eligibleNotes).toBe(1);
    expect(JSON.stringify(r)).not.toContain("private name");
  });
  it("does not sync while paused, and syncs again after resume", async () => {
    const { sock, v, calls } = await service();
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    await callService(sock, "pause");
    const skipped = await callService<{ skipped: string }>(sock, "sync");
    expect(skipped!.data).toMatchObject({ skipped: "paused" });
    expect(calls.some((c) => c.includes("/documents"))).toBe(false);
    await callService(sock, "resume");
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.some((c) => c === "POST /api/obsidian/bridge/documents")).toBe(true);
  });
  it("syncs automatically a moment after a file changes (debounced into one pass)", async () => {
    const { v, calls } = await service();
    await v.write("a.md", NOTE(ID(1), true, "one"));
    await v.write("a.md", NOTE(ID(1), true, "two"));
    await v.write("a.md", NOTE(ID(1), true, "three"));
    await new Promise((r) => setTimeout(r, 500));
    expect(calls.filter((c) => c === "POST /api/obsidian/bridge/documents")).toHaveLength(1);
  });
  it("never syncs before the first sync was confirmed", async () => {
    const { sock, v, calls } = await service(undefined, { initialSyncConfirmedAt: undefined });
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    expect((await callService<{ skipped: string }>(sock, "sync"))!.data).toMatchObject({ skipped: "not ready" });
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.includes("/documents"))).toBe(false);
  });
  it("heartbeat is sent when something changes, not on every poll", async () => {
    const { svc, calls } = await service();
    const before = calls.filter((c) => c.includes("/heartbeat")).length;
    for (let i = 0; i < 5; i++) await svc.pollOnce();
    expect(calls.filter((c) => c.includes("/heartbeat")).length).toBe(before);
  });
});

describe("config", () => {
  const base = { version: 1, lifeosUrl: "https://life.example.com/", vaultPath: "/Users/x/Vault", vaultName: "V", deviceName: "M", backup: { localPath: "/b", externalPath: null } };
  it("accepts a valid config and fills defaults", () => {
    expect(validateConfig(base)).toMatchObject({ lifeosUrl: "https://life.example.com", pollSeconds: 15, trashFolder: ".trash", pdfMaxBytes: 100 * 1024 * 1024 });
  });
  it("rejects bad values with a clear message", () => {
    const bad = (over: Record<string, unknown>) => () => validateConfig({ ...base, ...over });
    expect(bad({ lifeosUrl: "http://life.example.com" })).toThrow(/https/);
    expect(bad({ lifeosUrl: "nope" })).toThrow(ConfigError);
    expect(bad({ vaultPath: "relative/path" })).toThrow(/absolute/);
    expect(bad({ pollSeconds: 1 })).toThrow(/between 5/);
    expect(bad({ pdfMaxBytes: 500 * 1024 * 1024 })).toThrow(/100 MB/);
    expect(bad({ trashFolder: "../x" })).toThrow(/trashFolder/);
    expect(bad({ version: 2 })).toThrow(/version/);
    expect(bad({ backup: { localPath: "relative" } })).toThrow(/absolute/);
  });
  it("allows plain http only for localhost", () => {
    expect(() => validateConfig({ ...base, lifeosUrl: "http://localhost:3000" })).not.toThrow();
  });
  it("is saved privately and has no place for a token", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "cfg-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const file = join(home, "c.json");
    await saveConfig(validateConfig(base), file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(Object.keys(await loadConfig(file))).not.toContain("token");
    await writeFile(file, "{ not json");
    await expect(loadConfig(file)).rejects.toThrow(/damaged/);
  });
});

describe("logs never carry secrets or note text", () => {
  it("redacts sensitive keys and trims long values", () => {
    const r = redact({ token: "abc", content: "note text", authorization: "Bearer x", path: "a.md", note: "y".repeat(500) });
    expect(r).toMatchObject({ token: "[redacted]", content: "[redacted]", authorization: "[redacted]", path: "a.md" });
    expect(String(r.note).length).toBeLessThan(310);
  });
});

describe("command line", () => {
  const capture = async (args: string[]) => {
    const lines: string[] = [];
    const o = process.stdout.write.bind(process.stdout);
    const e = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
    try {
      return { code: await main(args), text: lines.join("") };
    } finally {
      process.stdout.write = o;
      process.stderr.write = e;
    }
  };
  it("has help for every command", async () => {
    for (const c of ["setup", "status", "doctor", "sync", "pause", "resume", "backup", "restore", "logs", "pair", "unpair", "version"]) {
      const r = await capture(["help", c]);
      expect(r.code).toBe(0);
      expect(r.text).toContain(`obsidian-bridge ${c}`);
    }
    expect((await capture([])).text).toContain("setup");
  });
  it("prints the version, reports unknown commands, and asks for setup when nothing is configured", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "emptyhome-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const prev = process.env.OBSIDIAN_BRIDGE_HOME;
    process.env.OBSIDIAN_BRIDGE_HOME = home;
    try {
      expect((await capture(["version"])).text.trim()).toMatch(/^\d+\.\d+\.\d+$/);
      expect((await capture(["bogus"])).code).toBe(1);
      const b = await capture(["backup", "list"]);
      expect(b.code).toBe(1);
      expect(b.text).toMatch(/setup/);
      expect((await capture(["restore", "preview"])).code).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.OBSIDIAN_BRIDGE_HOME;
      else process.env.OBSIDIAN_BRIDGE_HOME = prev;
    }
  });
});

describe("backups inside the service", () => {
  const volumes: VolumeProvider = { info: async () => ({ uuid: "u", mountPoint: "/", name: "x", encrypted: true }), findByUuid: async () => null };
  async function withBackups(now: () => Date) {
    const v = await makeVault();
    const dest = await realpath(await mkdtemp(join(tmpdir(), "svc-bk-")));
    cleanups.push(v.cleanup, () => rm(dest, { recursive: true, force: true }));
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    const backups = new BackupManager({ vaultPath: v.dir, vaultName: "T", settings: { localPath: dest, externalPath: null }, volumes, log: silentLogger, now });
    const home = await realpath(await mkdtemp(join(tmpdir(), "bh-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const creds = new MemoryCredentialStore();
    await creds.set("dev1", "token-token-token-token-1");
    const cfg: BridgeConfig = { version: 1, lifeosUrl: "https://x.test", vaultPath: v.dir, vaultName: "T", deviceName: "M", deviceId: "dev1", backup: { localPath: dest, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8, initialSyncConfirmedAt: new Date().toISOString() };
    const beats: Record<string, unknown>[] = [];
    const svc = new BridgeService({
      cfg, configFile: join(home, "config.json"), stateFile: join(home, "state.json"), socketPath: join(home, "b.sock"), state: emptyState(), credentials: creds,
      extractPdf: createPdfExtractor(join(NATIVE, "pdf-text")), log: silentLogger, backups,
      fetch: async (url, init) => {
        if (url.includes("/heartbeat")) beats.push(JSON.parse(String(init?.body)));
        return Response.json(url.includes("/poll") ? POLL : { ok: true, status: "synced", received: 0, expected: 0 });
      },
      debounceMs: 20, reconcileEveryMs: 3_600_000, wakeCheckMs: 3_600_000, backupCheckMs: 50,
    });
    await svc.start();
    cleanups.push(() => svc.stop());
    return { svc, v, dest, backups, beats, sock: join(home, "b.sock") };
  }

  it("runs the scheduled backup by itself when one is due, once per cycle, and reports it", async () => {
    let now = new Date(2026, 10, 9, 3, 0, 0);
    const { svc, dest, backups, beats } = await withBackups(() => now);
    await new Promise((r) => setTimeout(r, 400));
    const destDir = join(dest, "ObsidianBridge/T");
    expect(await listSnapshots(destDir)).toHaveLength(1);
    expect(svc.status().backup.local).toMatchObject({ status: "ok", files: 2 });
    expect(beats.some((b) => (b.details as Record<string, string>)?.backup_local === "ok")).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await listSnapshots(destDir)).toHaveLength(1); // same cycle: no second backup
    now = new Date(2026, 10, 10, 2, 1, 0); // next night
    await new Promise((r) => setTimeout(r, 400));
    expect(await listSnapshots(destDir)).toHaveLength(2);
    void backups;
  });
  it("backs up on request over the control socket and lists the restore points", async () => {
    const { sock, dest } = await withBackups(() => new Date(2026, 10, 9, 3, 0, 0));
    await new Promise((r) => setTimeout(r, 300));
    const r = await callService<{ status: string }[]>(sock, "backup", { full: true }, 60_000);
    expect(r!.ok).toBe(true);
    expect(r!.data![0]).toMatchObject({ destination: "local", status: "ok", mode: "full" });
    const l = await callService<{ destination: string; snapshots: { labels: string[] }[] }[]>(sock, "backup-list");
    expect(l!.data![0].snapshots.length).toBe(2);
    expect(l!.data![0].snapshots.some((x) => x.labels.includes("manual"))).toBe(true); // (the fake clock is frozen, so order by time is not meaningful here)
    expect(await listSnapshots(join(dest, "ObsidianBridge/T"))).toHaveLength(2);
  });
  it("without a backup system, edits and deletes stay refused", async () => {
    const { svc } = await service();
    expect(svc.status().backup.configured).toBe(false);
    await expect(svc.backupNow()).rejects.toThrow(/not set up/);
  });
});

describe("one Bridge at a time, and no restart loop", () => {
  const baseOpts = async () => {
    const v = await makeVault();
    const home = await realpath(await mkdtemp(join(tmpdir(), "one-")));
    cleanups.push(v.cleanup, () => rm(home, { recursive: true, force: true }));
    const creds = new MemoryCredentialStore();
    await creds.set("dev1", "token-token-token-token-1");
    return { v, home, creds };
  };
  const make = (b: Awaited<ReturnType<typeof baseOpts>>, over: { deviceId?: string; creds?: MemoryCredentialStore } = {}) =>
    new BridgeService({
      cfg: { version: 1, lifeosUrl: "https://x.test", vaultPath: b.v.dir, vaultName: "T", deviceName: "M", deviceId: over.deviceId ?? "dev1", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8 },
      configFile: join(b.home, "config.json"), stateFile: join(b.home, "state.json"), socketPath: join(b.home, "b.sock"), pidFile: join(b.home, "bridge.pid"), state: emptyState(), credentials: over.creds ?? b.creds,
      extractPdf: createPdfExtractor(join(NATIVE, "pdf-text")), log: silentLogger, fetch: async (url) => Response.json(String(url).includes("/poll") ? POLL : { ok: true }),
      debounceMs: 20, reconcileEveryMs: 3_600_000, wakeCheckMs: 3_600_000,
    });

  it("a second service refuses to start while the first is alive, and does not disturb its socket", async () => {
    const b = await baseOpts();
    const first = make(b);
    await first.start();
    cleanups.push(() => first.stop());
    await expect(make(b).start()).rejects.toThrow(AlreadyRunningError);
    expect((await callService(join(b.home, "b.sock"), "status"))!.ok).toBe(true); // the first one still answers
  });
  it("a leftover process id file from a dead process does not block a start, and stopping cleans it up", async () => {
    const b = await baseOpts();
    await writeFile(join(b.home, "bridge.pid"), "999999");
    const svc = make(b);
    await svc.start();
    expect(Number((await readFile(join(b.home, "bridge.pid"), "utf8")).split("\n")[0])).toBe(process.pid);
    await svc.stop();
    await expect(readFile(join(b.home, "bridge.pid"), "utf8")).rejects.toThrow();
    // and a live process id (this one) written by someone else blocks
    await writeFile(join(b.home, "bridge.pid"), `${process.ppid}\n${await processStartTime(process.ppid)}`);
    await expect(make(b).start()).rejects.toThrow(AlreadyRunningError);
  });
  it("a process id reused by an unrelated process (different start time) does not lock the Bridge out", async () => {
    const b = await baseOpts();
    await writeFile(join(b.home, "bridge.pid"), `${process.ppid}\nMon Jan  1 00:00:00 2001`);
    const svc = make(b);
    await svc.start();
    cleanups.push(() => svc.stop());
    expect((await callService(join(b.home, "b.sock"), "status"))!.ok).toBe(true);
  });
  it("an unpaired Mac is reported as such, and leaves nothing behind", async () => {
    const b = await baseOpts();
    await expect(make(b, { deviceId: "nobody" }).start()).rejects.toThrow(NotPairedError);
    await expect(readFile(join(b.home, "bridge.pid"), "utf8")).rejects.toThrow();
  });
  it("`run` with nothing set up or nobody paired exits cleanly (so launchd does not restart it in a loop)", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "runhome-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const prev = process.env.OBSIDIAN_BRIDGE_HOME;
    process.env.OBSIDIAN_BRIDGE_HOME = home;
    try {
      const lines: string[] = [];
      const e = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
      try {
        expect(await main(["run"])).toBe(0);
        const v = await makeVault();
        cleanups.push(v.cleanup);
        await saveConfig(validateConfig({ version: 1, lifeosUrl: "https://x.test", vaultPath: v.dir, vaultName: "V", deviceName: "M", backup: { localPath: null, externalPath: null } }));
        expect(await main(["run"])).toBe(0);
        // a config that cannot be read is a real fault: exit non-zero so launchd tries again
        await writeFile(join(home, "config.json"), "{not json");
        expect(await main(["run"])).toBe(1);
      } finally {
        process.stderr.write = e;
      }
      expect(lines.join("")).toMatch(/Not set up yet/);
      expect(lines.join("")).toMatch(/not paired/);
    } finally {
      if (prev === undefined) delete process.env.OBSIDIAN_BRIDGE_HOME;
      else process.env.OBSIDIAN_BRIDGE_HOME = prev;
    }
  });
});

describe("command line arguments", () => {
  it("keeps values that contain =", () => {
    const { words, flags } = parseArgs(["setup", "--url=https://host.example/?tenant=a&x=1", "--vault=/Users/me/Notes=old", "--yes", "--name", "My Mac", "--code=AB=CD"]);
    expect(words).toEqual(["setup"]);
    expect(flags).toEqual({ url: "https://host.example/?tenant=a&x=1", vault: "/Users/me/Notes=old", yes: true, name: "My Mac", code: "AB=CD" });
    expect(parseArgs(["sync", "--allow-removals"]).flags["allow-removals"]).toBe(true);
    // a boolean flag does not swallow the word after it
    const a = parseArgs(["sync", "--allow-removals", "extra"]);
    expect(a.flags["allow-removals"]).toBe(true);
    expect(a.words).toEqual(["sync", "extra"]);
  });
});
