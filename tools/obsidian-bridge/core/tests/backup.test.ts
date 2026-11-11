import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupManager } from "../src/backup/manager.js";
import { createSnapshot, listSnapshots, pruneSnapshots, scanSource, verifySnapshot } from "../src/backup/store.js";
import { cycleKeys, dueLabels, lastOccurrence, modeFor } from "../src/backup/schedule.js";
import { applyMerge, browse, conflictDiff, planMerge, restorePreview, restoreToNewVault } from "../src/backup/restore.js";
import { parseDiskutil, type VolumeInfo, type VolumeProvider } from "../src/backup/volumes.js";
import { executeCommand } from "../src/approvals/executor.js";
import { silentLogger } from "../src/logging.js";
import type { BridgeConfig } from "../src/config/config.js";
import { sha256 } from "../src/vault/scan.js";
import { ID, NOTE } from "./helpers/vault.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const tmp = async (p: string) => {
  const d = await realpath(await mkdtemp(join(tmpdir(), p)));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};
const put = async (root: string, rel: string, text: string | Buffer) => {
  await mkdir(join(root, ...rel.split("/").slice(0, -1)), { recursive: true });
  await writeFile(join(root, ...rel.split("/")), text);
};
const ino = async (p: string) => (await stat(p)).ino;
const nlink = async (p: string) => (await stat(p)).nlink;

class FakeVolumes implements VolumeProvider {
  mounts = new Map<string, string | null>();
  encrypted: boolean | null = true;
  async info(): Promise<VolumeInfo> {
    return { uuid: "u", mountPoint: "/", name: "x", encrypted: this.encrypted };
  }
  async findByUuid(uuid: string) {
    return this.mounts.get(uuid) ?? null;
  }
}

const local = (y: number, m: number, d: number, h = 2, min = 0) => new Date(y, m - 1, d, h, min, 0);

async function setupVault() {
  const vault = await tmp("bk-vault-");
  const dest = await tmp("bk-dest-");
  await put(vault, ".obsidian/app.json", '{"theme":"dark"}');
  await put(vault, ".obsidian/plugins/x/data.json", "{}");
  await put(vault, "Programming/Java/OOP.md", NOTE(ID(1), true, "# OOP\nPolymorphism\n"));
  await put(vault, "Languages/ภาษาไทย.md", "เนื้อหาภาษาไทย");
  await put(vault, "PDFs/lecture.pdf", Buffer.from("%PDF-1.4 binary \u0000\u0001"));
  await put(vault, "Images/pic.png", Buffer.from([137, 80, 78, 71, 0, 1, 2]));
  await put(vault, "Templates/daily.md", "template");
  await put(vault, ".trash/old.md", "deleted earlier");
  await mkdir(join(vault, "Empty Folder"));
  return { vault, dest };
}

const manager = (vault: string, dest: string, over: Partial<ConstructorParameters<typeof BackupManager>[0]> & { now?: () => Date } = {}) => {
  const volumes = new FakeVolumes();
  const m = new BackupManager({ vaultPath: vault, vaultName: "James Knowledge", settings: { localPath: dest, externalPath: null }, volumes, log: silentLogger, ...over });
  return { m, volumes };
};

describe("schedule", () => {
  it("knows the last scheduled time for daily, weekly (Sunday) and monthly (1st) at 02:00", () => {
    const wed = local(2026, 11, 11, 15, 30); // Wednesday
    expect(lastOccurrence(wed, "daily")).toEqual(local(2026, 11, 11));
    expect(lastOccurrence(wed, "weekly")).toEqual(local(2026, 11, 8)); // Sunday
    expect(lastOccurrence(wed, "monthly")).toEqual(local(2026, 11, 1));
    const early = local(2026, 11, 11, 1, 59); // not yet 02:00
    expect(lastOccurrence(early, "daily")).toEqual(local(2026, 11, 10));
    expect(lastOccurrence(local(2026, 11, 8, 1, 0), "weekly")).toEqual(local(2026, 11, 1));
    expect(lastOccurrence(local(2026, 11, 1, 1, 0), "monthly")).toEqual(local(2026, 10, 1));
  });
  it("one backup can satisfy several cycles without a duplicate copy, and runs once for each cycle only", () => {
    const sunFirst = local(2026, 11, 1, 3); // Sunday the 1st
    expect(dueLabels(sunFirst, [])).toEqual(["daily", "weekly", "monthly"]);
    const keys = cycleKeys(sunFirst);
    const done = [{ cycles: keys }];
    expect(dueLabels(sunFirst, done)).toEqual([]);
    expect(dueLabels(local(2026, 11, 1, 23, 59), done)).toEqual([]);
    expect(dueLabels(local(2026, 11, 2, 2, 0), done)).toEqual(["daily"]);
  });
  it("a Mac that was off for days runs one catch-up backup, not one per missed day", () => {
    const last = [{ cycles: cycleKeys(local(2026, 11, 8, 3)) }]; // backed up Sunday
    const back = local(2026, 11, 12, 9); // Thursday morning
    expect(dueLabels(back, last)).toEqual(["daily"]);
    // asleep through the next Sunday: weekly and daily are both due, once
    expect(dueLabels(local(2026, 11, 17, 9), last)).toEqual(["daily", "weekly"]);
  });
  it("picks full for the first, weekly and monthly backups and incremental for ordinary days", () => {
    expect(modeFor(["daily"], false)).toBe("full");
    expect(modeFor(["daily"], true)).toBe("incremental");
    expect(modeFor(["daily", "weekly"], true)).toBe("full");
    expect(modeFor(["daily", "monthly"], true)).toBe("full");
  });
});

describe("snapshots", () => {
  it("the first backup is a complete copy of everything, including hidden files, empty folders and links", async () => {
    const { vault, dest } = await setupVault();
    await symlink("Programming/Java/OOP.md", join(vault, "link.md"));
    await put(vault, ".DS_Store", "x");
    await put(vault, "Programming/.abc123.bridge-tmp", "x");
    const { m } = manager(vault, dest, { now: () => local(2026, 11, 11, 2) });
    const [r] = await m.backupNow();
    expect(r).toMatchObject({ destination: "local", status: "ok", mode: "full" });
    const [snap] = (await m.list())[0].snapshots;
    const paths = snap.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining([".obsidian/app.json", ".obsidian/plugins/x/data.json", ".trash/old.md", "Languages/ภาษาไทย.md", "PDFs/lecture.pdf", "Images/pic.png", "Templates/daily.md", "link.md"]));
    expect(paths.some((p) => p.endsWith(".bridge-tmp") || p.endsWith(".DS_Store"))).toBe(false);
    expect(snap.dirs).toContain("Empty Folder");
    expect(snap.excluded).toMatch(/bridge-tmp/);
    const root = join(dest, "ObsidianBridge/James Knowledge/snapshots", snap.id, "files");
    expect(await readFile(join(root, "Languages/ภาษาไทย.md"), "utf8")).toBe("เนื้อหาภาษาไทย");
    expect(await readFile(join(root, "PDFs/lecture.pdf"))).toEqual(await readFile(join(vault, "PDFs/lecture.pdf")));
    expect((await lstat(join(root, "link.md"))).isSymbolicLink()).toBe(true);
    expect((await stat(join(root, "Empty Folder"))).isDirectory()).toBe(true);
    expect(snap.labels).toEqual(expect.arrayContaining(["manual", "daily", "weekly", "monthly"]));
  });
  it("a daily incremental reuses unchanged files (hard links), copies changed ones, and stays complete", async () => {
    const { vault, dest } = await setupVault();
    let now = local(2026, 11, 9, 2); // Monday
    const { m } = manager(vault, dest, { now: () => now });
    await m.runScheduled(); // first: full
    await put(vault, "Programming/Java/OOP.md", NOTE(ID(1), true, "# OOP\nPolymorphism and more\n"));
    await put(vault, "New/added.md", "new file");
    await rm(join(vault, "Templates/daily.md"));
    now = local(2026, 11, 10, 2); // Tuesday
    const [r] = (await m.runScheduled())!;
    expect(r).toMatchObject({ status: "ok", mode: "incremental", labels: ["daily"] });
    const snaps = (await m.list())[0].snapshots; // newest first
    expect(snaps).toHaveLength(2);
    const [s2, s1] = snaps.map((s) => join(dest, "ObsidianBridge/James Knowledge/snapshots", s.id, "files"));
    expect(snaps[0].linkedFiles).toBeGreaterThan(5);
    expect(snaps[0].copiedFiles).toBe(2); // the changed note and the new one
    expect(await ino(join(s2, "Images/pic.png"))).toBe(await ino(join(s1, "Images/pic.png")));
    expect(await nlink(join(s2, "Images/pic.png"))).toBe(2);
    expect(await ino(join(s2, "Programming/Java/OOP.md"))).not.toBe(await ino(join(s1, "Programming/Java/OOP.md")));
    // each one is a complete restore point of its own day
    expect(await readFile(join(s1, "Programming/Java/OOP.md"), "utf8")).toContain("Polymorphism\n");
    expect(await readFile(join(s2, "Programming/Java/OOP.md"), "utf8")).toContain("and more");
    expect(await readFile(join(s1, "Templates/daily.md"), "utf8")).toBe("template");
    await expect(stat(join(s2, "Templates/daily.md"))).rejects.toThrow();
    expect((await verifySnapshot(join(dest, "ObsidianBridge/James Knowledge"), snaps[1].id)).ok).toBe(true);
  });
  it("weekly and monthly snapshots are full copies that share nothing with earlier ones", async () => {
    const { vault, dest } = await setupVault();
    let now = local(2026, 11, 3, 2); // Tuesday
    const { m } = manager(vault, dest, { now: () => now });
    await m.runScheduled();
    now = local(2026, 11, 4, 2);
    await m.runScheduled(); // incremental
    now = local(2026, 11, 8, 2); // Sunday: weekly
    const [weekly] = (await m.runScheduled())!;
    expect(weekly).toMatchObject({ mode: "full", labels: ["daily", "weekly"] });
    const snaps = (await m.list())[0].snapshots;
    expect(snaps[0].linkedFiles).toBe(0);
    const base = (i: number) => join(dest, "ObsidianBridge/James Knowledge/snapshots", snaps[i].id, "files");
    expect(await ino(join(base(0), "Images/pic.png"))).not.toBe(await ino(join(base(1), "Images/pic.png")));
    expect(await nlink(join(base(0), "Images/pic.png"))).toBe(1);
    now = local(2026, 12, 1, 2); // the 1st: monthly
    const [monthly] = (await m.runScheduled())!;
    expect(monthly).toMatchObject({ mode: "full" });
    expect(monthly.labels).toContain("monthly");
  });
  it("does not run twice for the same cycle, and waits until 02:00", async () => {
    const { vault, dest } = await setupVault();
    let now = local(2026, 11, 9, 2, 5);
    const { m } = manager(vault, dest, { now: () => now });
    expect(await m.runScheduled()).not.toBeNull();
    expect(await m.runScheduled()).toBeNull();
    now = local(2026, 11, 9, 23, 0);
    expect(await m.runScheduled()).toBeNull();
    now = local(2026, 11, 10, 1, 59);
    expect(await m.runScheduled()).toBeNull();
    now = local(2026, 11, 10, 2, 0);
    expect(await m.runScheduled()).not.toBeNull();
    expect((await m.list())[0].snapshots).toHaveLength(2);
  });
  it("a file that keeps changing while it is copied is retried and flagged", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "ObsidianBridge/James Knowledge");
    let touched = 0;
    const { manifest } = await createSnapshot(destDir, {
      vaultPath: vault,
      vaultName: "J",
      labels: ["manual"],
      mode: "full",
      afterCopy: async (rel) => {
        if (rel === "Templates/daily.md" && touched++ === 0) await writeFile(join(vault, rel), "changed while copying, longer");
      },
    });
    expect(await readFile(join(destDir, "snapshots", manifest.id, "files/Templates/daily.md"), "utf8")).toBe("changed while copying, longer");
    expect(manifest.files.find((f) => f.path === "Templates/daily.md")!.size).toBe("changed while copying, longer".length);
  });
});

describe("basic verification", () => {
  it("passes a good snapshot and reports counts", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "d");
    const { manifest, verify } = await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["manual"], mode: "full" });
    expect(verify).toMatchObject({ ok: true, files: manifest.fileCount });
    expect((await scanSource(vault)).files).toHaveLength(manifest.fileCount);
  });
  it("detects a missing file, a size mismatch, an extra file and a missing manifest", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "d");
    const { manifest } = await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["manual"], mode: "full" });
    const files = join(destDir, "snapshots", manifest.id, "files");
    await truncate(join(files, "Images/pic.png"), 2);
    expect((await verifySnapshot(destDir, manifest.id)).problems.join()).toMatch(/size differs: Images\/pic.png/);
    await writeFile(join(files, "Images/pic.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2]));
    expect((await verifySnapshot(destDir, manifest.id)).ok).toBe(true);
    await rm(join(files, "Templates/daily.md"));
    expect((await verifySnapshot(destDir, manifest.id)).problems.join()).toMatch(/missing or unreadable: Templates\/daily.md|snapshot holds/);
    await writeFile(join(files, "Templates/daily.md"), "template");
    await writeFile(join(files, "stray.md"), "extra");
    expect((await verifySnapshot(destDir, manifest.id)).problems.join()).toMatch(/snapshot holds/);
    await rm(join(files, "stray.md"));
    await rm(join(destDir, "snapshots", manifest.id, "manifest.json"));
    expect((await verifySnapshot(destDir, manifest.id)).ok).toBe(false);
    expect(await listSnapshots(destDir)).toEqual([]); // not offered for restore
  });
  it("an unreadable file fails the backup, and no half snapshot is left behind or reported as success", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "d");
    await expect(
      createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["manual"], mode: "full", afterCopy: async (rel) => { if (rel === "Images/pic.png") await rm(join(destDir, "snapshots").replace(/$/, ""), { recursive: false, force: true }).catch(() => {}); } }),
    ).resolves.toBeTruthy(); // harmless hook: still fine
    // now break a copied file for real
    await expect(
      createSnapshot(destDir, {
        vaultPath: vault,
        vaultName: "J",
        labels: ["manual"],
        mode: "full",
        afterCopy: async (rel) => {
          if (rel === "Images/pic.png") {
            const work = (await readdir(join(destDir, "snapshots"))).find((n) => n.endsWith(".partial"))!;
            await rm(join(destDir, "snapshots", work, "files", rel));
          }
        },
      }),
    ).rejects.toThrow(/Verification failed/);
    expect((await readdir(join(destDir, "snapshots"))).filter((n) => n.endsWith(".partial"))).toEqual([]);
    expect((await listSnapshots(destDir)).length).toBe(1);
  });
});

describe("destinations", () => {
  it("backs up locally even when the external SSD is not connected, and says so separately", async () => {
    const { vault, dest } = await setupVault();
    const { m, volumes } = manager(vault, dest, { settings: { localPath: dest, externalPath: null, externalVolumeUuid: "SSD-1", externalSubpath: "Backups" }, now: () => local(2026, 11, 9, 3) });
    volumes.mounts.set("SSD-1", null);
    const r = await m.runScheduled();
    expect(r).toHaveLength(2);
    expect(r!.find((x) => x.destination === "local")).toMatchObject({ status: "ok" });
    expect(r!.find((x) => x.destination === "external")).toMatchObject({ status: "unavailable", message: expect.stringMatching(/External Backup Unavailable/) });
    const lists = await m.list();
    expect(lists.find((l) => l.destination === "external")).toMatchObject({ available: false, snapshots: [] });
  });
  it("finds the SSD by its volume id wherever it is mounted and catches up when it reconnects", async () => {
    const { vault, dest } = await setupVault();
    const ssd1 = await tmp("ssd-a-");
    const ssd2 = await tmp("ssd-b-");
    let now = local(2026, 11, 9, 3);
    const { m, volumes } = manager(vault, dest, { settings: { localPath: dest, externalPath: null, externalVolumeUuid: "SSD-1", externalSubpath: "Backups" }, now: () => now });
    volumes.mounts.set("SSD-1", null);
    await m.runScheduled();
    // plugged in, mounted at one path
    volumes.mounts.set("SSD-1", ssd1);
    now = local(2026, 11, 9, 20, 0);
    const caught = await m.runScheduled(); // local is up to date; only the external one is due
    expect(caught).toHaveLength(1);
    expect(caught![0]).toMatchObject({ destination: "external", status: "ok" });
    expect((await readdir(join(ssd1, "Backups/ObsidianBridge/James Knowledge/snapshots"))).length).toBe(1);
    // later mounted under a different name: same drive, found again
    volumes.mounts.set("SSD-1", ssd2);
    now = local(2026, 11, 10, 2);
    const next = await m.runScheduled();
    expect(next!.map((r) => r.destination).sort()).toEqual(["external", "local"]);
    // a mount point that holds no backups yet gets a first full copy
    const ext = (await m.list()).find((l) => l.destination === "external")!.snapshots;
    expect(ext).toHaveLength(1);
    expect(ext[0].mode).toBe("full");
  });
  it("reports the local folder as unavailable when it cannot be written", async () => {
    const { vault, dest } = await setupVault();
    const locked = join(dest, "locked");
    await mkdir(locked);
    await chmod(locked, 0o500);
    cleanups.unshift(async () => chmod(locked, 0o700));
    const { m } = manager(vault, locked);
    const [r] = await m.backupNow();
    expect(r).toMatchObject({ destination: "local", status: "unavailable" });
    expect(await m.safetyBackup("edit_note")).toMatchObject({ ok: false });
  });
  it("refuses an unencrypted drive unless the owner accepted that", async () => {
    const { vault, dest } = await setupVault();
    const { m, volumes } = manager(vault, dest);
    volumes.encrypted = false;
    expect((await m.backupNow())[0]).toMatchObject({ status: "unavailable", message: expect.stringMatching(/not encrypted/) });
    const accepted = manager(vault, dest, { settings: { localPath: dest, externalPath: null, allowUnencrypted: true } });
    accepted.volumes.encrypted = false;
    expect((await accepted.m.backupNow())[0]).toMatchObject({ status: "ok", encrypted: false });
  });
  it("reads diskutil output", () => {
    const text = "   Volume Name:               Samsung SSD\n   Volume UUID:               ABCD-1234\n   Mount Point:               /Volumes/Samsung SSD\n   FileVault:                 Yes\n";
    expect(parseDiskutil(text)).toEqual({ uuid: "ABCD-1234", mountPoint: "/Volumes/Samsung SSD", name: "Samsung SSD", encrypted: true });
    expect(parseDiskutil("   Encrypted:                 No\n").encrypted).toBe(false);
    expect(parseDiskutil("nothing useful").encrypted).toBeNull();
  });
});

describe("retention", () => {
  it("keeps 7 daily, 4 weekly and 3 monthly, and every kept restore point still restores its own day", async () => {
    const { vault, dest } = await setupVault();
    let now = local(2026, 9, 1, 2);
    const { m } = manager(vault, dest, { now: () => now });
    const content = new Map<string, string>();
    const created: { id: string; labels: string[] }[] = [];
    for (let day = 0; day < 100; day++) {
      now = new Date(2026, 8, 1 + day, 2, 0, 0); // every night for 100 days
      await put(vault, "Programming/Java/OOP.md", `version for day ${day}`);
      await put(vault, `Journal/${day % 5}.md`, `entry ${day}`);
      const r = await m.runScheduled();
      expect(r![0]).toMatchObject({ status: "ok" });
      const latest = (await m.list())[0].snapshots[0];
      content.set(latest.id, `version for day ${day}`);
      created.push({ id: latest.id, labels: latest.labels as string[] });
    }
    const snaps = (await m.list())[0].snapshots;
    // every snapshot that exists is there because some label keeps it, and every label keeps its newest N
    const want = new Set<string>();
    for (const [label, n] of Object.entries({ daily: 7, weekly: 4, monthly: 3 })) for (const c of created.filter((x) => x.labels.includes(label)).slice(-n)) want.add(c.id);
    expect(new Set(snaps.map((s) => s.id))).toEqual(want);
    expect(snaps.length).toBeGreaterThanOrEqual(10);
    expect(snaps.length).toBeLessThanOrEqual(7 + 4 + 3);
    expect(snaps.filter((s) => (s.labels as string[]).includes("monthly"))).toHaveLength(3);
    // the newest 7 days are all there
    const keptDays = snaps.slice(0, 7).map((s) => content.get(s.id));
    expect(keptDays).toEqual([99, 98, 97, 96, 95, 94, 93].map((d) => `version for day ${d}`));
    // weekly and monthly ones reach further back
    expect(snaps.slice(7).some((s) => (s.labels as string[]).includes("monthly"))).toBe(true);
    expect(snaps.slice(7).every((s) => (s.labels as string[]).some((l) => l === "weekly" || l === "monthly"))).toBe(true);
    // nothing a retained snapshot needs was deleted: all verify and hold their own content
    for (const s of snaps) {
      const v = await verifySnapshot(join(dest, "ObsidianBridge/James Knowledge"), s.id);
      expect(v.ok, s.id).toBe(true);
      expect(await readFile(join(dest, "ObsidianBridge/James Knowledge/snapshots", s.id, "files/Programming/Java/OOP.md"), "utf8")).toBe(content.get(s.id));
    }
  });
  it("deleting an old snapshot never breaks a newer one that shared its files", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "d");
    const a = await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["daily"], cycles: { daily: "1" }, mode: "full", now: new Date(2026, 0, 1) });
    const b = await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["daily"], cycles: { daily: "2" }, mode: "incremental", now: new Date(2026, 0, 2) });
    expect(b.manifest.linkedFiles).toBeGreaterThan(0);
    await rm(join(destDir, "snapshots", a.manifest.id), { recursive: true });
    expect((await verifySnapshot(destDir, b.manifest.id)).ok).toBe(true);
    expect(await readFile(join(destDir, "snapshots", b.manifest.id, "files/Languages/ภาษาไทย.md"), "utf8")).toBe("เนื้อหาภาษาไทย");
  });
  it("deletes nothing at all if a snapshot it is keeping is damaged", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "d");
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push((await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["daily"], cycles: { daily: String(i) }, mode: "full", now: new Date(2026, 0, 1 + i) })).manifest.id);
    // 9 dailies, keep 7: the two oldest would go
    await rm(join(destDir, "snapshots", ids[8], "files/Templates/daily.md"));
    const r = await pruneSnapshots(destDir);
    expect(r.deleted).toEqual([]);
    expect(r.skipped).toMatch(/not complete/);
    expect(await readdir(join(destDir, "snapshots"))).toHaveLength(9);
  });
  it("the new backup is verified before anything old is removed", async () => {
    const { vault, dest } = await setupVault();
    const destDir = join(dest, "ObsidianBridge/J");
    for (let i = 0; i < 7; i++) await createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["daily"], cycles: { daily: String(i) }, mode: "full", now: new Date(2026, 0, 1 + i) });
    // the 8th fails verification: the 7 existing ones must all remain
    await expect(
      createSnapshot(destDir, { vaultPath: vault, vaultName: "J", labels: ["daily"], mode: "full", now: new Date(2026, 0, 9), afterCopy: async (rel) => { if (rel === "Images/pic.png") await rm(join(destDir, "snapshots", (await readdir(join(destDir, "snapshots"))).find((n) => n.endsWith(".partial"))!, "files", rel)); } }),
    ).rejects.toThrow();
    expect(await listSnapshots(destDir)).toHaveLength(7);
  });
});

describe("safety backup before Claude changes things", () => {
  const cfgFor = (vault: string): BridgeConfig => ({ version: 1, lifeosUrl: "https://x.test", vaultPath: vault, vaultName: "J", deviceName: "M", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8 });
  const cmd = (op: string, payload: Record<string, unknown>) => ({ id: "c", op, payload, expected_hash: typeof payload.expected_hash === "string" ? payload.expected_hash : null, expires_at: new Date(Date.now() + 3600_000).toISOString(), secret_findings: 0 });

  it("an edit is preceded by a snapshot that holds the old note; a new note needs none", async () => {
    const { vault, dest } = await setupVault();
    const { m } = manager(vault, dest);
    const deps = { cfg: cfgFor(vault), log: silentLogger, safetyBackup: (r: string) => m.safetyBackup(r) };
    const original = await readFile(join(vault, "Programming/Java/OOP.md"), "utf8");
    expect((await executeCommand(cmd("create_note", { path: "New.md", content: "x" }), deps)).status).toBe("applied");
    expect((await m.list())[0].snapshots).toHaveLength(0);
    const r = await executeCommand(cmd("edit_note", { path: "Programming/Java/OOP.md", new_content: "rewritten\n", expected_hash: sha256(original) }), deps);
    expect(r.status).toBe("applied");
    const [snap] = (await m.list())[0].snapshots;
    expect(snap.labels).toEqual(["safety"]);
    expect(await readFile(join(dest, "ObsidianBridge/James Knowledge/snapshots", snap.id, "files/Programming/Java/OOP.md"), "utf8")).toBe(original);
    expect(await readFile(join(vault, "Programming/Java/OOP.md"), "utf8")).toContain("rewritten");
  });
  it("a folder delete is preceded by a snapshot of the whole folder, then goes to the trash", async () => {
    const { vault, dest } = await setupVault();
    const { m } = manager(vault, dest);
    const deps = { cfg: cfgFor(vault), log: silentLogger, safetyBackup: (r: string) => m.safetyBackup(r) };
    expect((await executeCommand(cmd("delete_folder", { path: "Programming" }), deps)).status).toBe("applied");
    const [snap] = (await m.list())[0].snapshots;
    expect(snap.files.map((f) => f.path)).toContain("Programming/Java/OOP.md");
    await expect(stat(join(vault, "Programming"))).rejects.toThrow();
  });
  it("when the backup folder is not writable the change does not happen", async () => {
    const { vault } = await setupVault();
    const { m } = manager(vault, "/this/folder/does/not/exist");
    const deps = { cfg: cfgFor(vault), log: silentLogger, safetyBackup: (r: string) => m.safetyBackup(r) };
    const r = await executeCommand(cmd("delete_note", { path: "Templates/daily.md" }), deps);
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/Safety backup failed/) });
    expect(await readFile(join(vault, "Templates/daily.md"), "utf8")).toBe("template");
  });
  it("safety snapshots are pruned to the newest ten", async () => {
    const { vault, dest } = await setupVault();
    let t = 0;
    const { m } = manager(vault, dest, { now: () => new Date(2026, 10, 11, 12, 0, t++) });
    for (let i = 0; i < 14; i++) expect((await m.safetyBackup("edit_note")).ok).toBe(true);
    expect((await m.list())[0].snapshots).toHaveLength(10);
  });
});

describe("restore", () => {
  async function withBackup() {
    const { vault, dest } = await setupVault();
    const { m } = manager(vault, dest, { now: () => local(2026, 11, 9, 3) });
    await m.runScheduled();
    const destDir = join(dest, "ObsidianBridge/James Knowledge");
    const [snap] = await listSnapshots(destDir);
    return { vault, dest, destDir, snap, m };
  }
  const tree = async (root: string) => {
    const s = await scanSource(root);
    return [...s.dirs.map((d) => `d:${d}`), ...(await Promise.all(s.files.map(async (f) => `f:${f.path}:${f.type === "file" ? sha256(await readFile(join(root, f.path))) : f.target}`)))].sort();
  };

  it("previews and browses a backup without changing anything", async () => {
    const { vault, destDir, snap } = await withBackup();
    const before = await tree(vault);
    const p = await restorePreview(destDir, snap.id);
    expect(p).toMatchObject({ files: snap.fileCount, intact: true });
    expect(p.topLevel.map((t) => t.name)).toContain("Programming");
    expect((await browse(destDir, snap.id)).map((e) => e.name)).toEqual(expect.arrayContaining([".obsidian", "Empty Folder", "Programming", "Languages"]));
    expect(await browse(destDir, snap.id, "Programming/Java")).toEqual([{ name: "OOP.md", type: "file", size: expect.any(Number) }]);
    expect(await tree(vault)).toEqual(before);
  });
  it("restores into a new vault with the same structure, notes, attachments and settings", async () => {
    const { vault, destDir, snap } = await withBackup();
    const target = join(await tmp("rv-"), "Restored Vault");
    const r = await restoreToNewVault(destDir, snap.id, target, { currentVault: vault });
    expect(r).toMatchObject({ files: snap.fileCount, includesObsidianSettings: true });
    expect(await tree(target)).toEqual(await tree(vault));
  });
  it("refuses a non-empty folder, a folder inside the current vault, and a damaged backup", async () => {
    const { vault, destDir, snap } = await withBackup();
    const busy = await tmp("busy-");
    await writeFile(join(busy, "x"), "x");
    await expect(restoreToNewVault(destDir, snap.id, busy)).rejects.toThrow(/not empty/);
    await expect(restoreToNewVault(destDir, snap.id, join(vault, "inside"), { currentVault: vault })).rejects.toThrow(/inside/);
    await rm(join(destDir, "snapshots", snap.id, "files/Images/pic.png"));
    await expect(restoreToNewVault(destDir, snap.id, join(await tmp("t-"), "v"))).rejects.toThrow(/damaged/);
    await expect(restorePreview(destDir, "nope")).rejects.toThrow(/not found/);
  });

  it("safe merge adds missing files, skips identical ones and never touches different ones by default", async () => {
    const { vault, destDir, snap, m } = await withBackup();
    await rm(join(vault, "Templates/daily.md"));
    await writeFile(join(vault, "Programming/Java/OOP.md"), "I edited this today");
    await put(vault, "Only/now.md", "created after the backup");
    const plan = await planMerge(destDir, snap.id, vault);
    expect(plan.add).toEqual(["Templates/daily.md"]);
    expect(plan.conflicts).toEqual(["Programming/Java/OOP.md"]);
    expect(plan.identical).toBe(snap.fileCount - 2);
    const report = await applyMerge(destDir, snap.id, vault, { safetyBackup: () => m.safetyBackup("restore") });
    expect(report).toMatchObject({ added: 1, keptCurrent: 1, overwritten: 0 });
    expect(report.safetyBackupId).toBeTruthy();
    expect(await readFile(join(vault, "Templates/daily.md"), "utf8")).toBe("template");
    expect(await readFile(join(vault, "Programming/Java/OOP.md"), "utf8")).toBe("I edited this today");
    expect(await readFile(join(vault, "Only/now.md"), "utf8")).toBe("created after the backup");
  });
  it("makes a safety backup first, and stops with nothing changed if it fails", async () => {
    const { vault, destDir, snap } = await withBackup();
    await rm(join(vault, "Templates/daily.md"));
    const before = await tree(vault);
    await expect(applyMerge(destDir, snap.id, vault, { safetyBackup: async () => ({ ok: false, message: "disk full" }) })).rejects.toThrow(/Safety backup failed/);
    expect(await tree(vault)).toEqual(before);
  });
  it("Keep Both restores the backup copy under a unique name and keeps the current file", async () => {
    const { vault, destDir, snap, m } = await withBackup();
    await writeFile(join(vault, "Programming/Java/OOP.md"), "current version");
    const when = local(2026, 11, 11, 14, 5);
    const report = await applyMerge(destDir, snap.id, vault, { resolutions: { "Programming/Java/OOP.md": "keep_both" }, safetyBackup: () => m.safetyBackup("restore"), now: when });
    expect(report.keptBoth).toEqual([{ path: "Programming/Java/OOP.md", restoredAs: "Programming/Java/OOP (restored 2026-11-11 1405).md" }]);
    expect(report.linkNote).toMatch(/Links inside your notes were not changed/);
    expect(await readFile(join(vault, "Programming/Java/OOP.md"), "utf8")).toBe("current version");
    expect(await readFile(join(vault, "Programming/Java/OOP (restored 2026-11-11 1405).md"), "utf8")).toContain("Polymorphism");
    // doing it again never overwrites the first restored copy
    const again = await applyMerge(destDir, snap.id, vault, { resolutions: { "Programming/Java/OOP.md": "keep_both" }, safetyBackup: () => m.safetyBackup("restore"), now: when });
    expect(again.keptBoth[0].restoredAs).toBe("Programming/Java/OOP (restored 2026-11-11 1405 2).md");
  });
  it("Restore Backup Version replaces the current file only after explicit confirmation", async () => {
    const { vault, destDir, snap, m } = await withBackup();
    await writeFile(join(vault, "Programming/Java/OOP.md"), "current version");
    const opts = { resolutions: { "Programming/Java/OOP.md": "restore_backup" as const }, safetyBackup: () => m.safetyBackup("restore") };
    await expect(applyMerge(destDir, snap.id, vault, opts)).rejects.toThrow(/explicit confirmation/);
    expect(await readFile(join(vault, "Programming/Java/OOP.md"), "utf8")).toBe("current version");
    const r = await applyMerge(destDir, snap.id, vault, { ...opts, confirmOverwrite: true });
    expect(r.overwritten).toBe(1);
    expect(await readFile(join(vault, "Programming/Java/OOP.md"), "utf8")).toContain("Polymorphism");
    // the current version was saved by the safety backup made first
    const safety = (await m.list())[0].snapshots.find((s) => (s.labels as string[]).includes("safety"))!;
    expect(await readFile(join(destDir, "snapshots", safety.id, "files/Programming/Java/OOP.md"), "utf8")).toBe("current version");
  });
  it("shows what differs in a conflicting file", async () => {
    const { vault, destDir, snap } = await withBackup();
    await writeFile(join(vault, "Programming/Java/OOP.md"), NOTE(ID(1), true, "# OOP\nSomething else\n"));
    const d = await conflictDiff(destDir, snap.id, vault, "Programming/Java/OOP.md");
    expect(d).toContain("-Something else");
    expect(d).toContain("+Polymorphism");
    await writeFile(join(vault, "Images/pic.png"), Buffer.from([0, 0, 0]));
    expect(await conflictDiff(destDir, snap.id, vault, "Images/pic.png")).toMatch(/Binary file/);
  });
});

void link;
