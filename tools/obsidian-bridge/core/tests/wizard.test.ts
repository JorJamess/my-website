import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWizard } from "../src/cli/wizard.js";
import { MemoryCredentialStore } from "../src/security/keychain.js";
import { ID, makeVault, NOTE } from "./helpers/vault.js";

const cleanups: (() => Promise<unknown>)[] = [];
let home: string;
let prevHome: string | undefined;
beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "wz-home-")));
  prevHome = process.env.OBSIDIAN_BRIDGE_HOME;
  process.env.OBSIDIAN_BRIDGE_HOME = home;
  cleanups.push(() => rm(home, { recursive: true, force: true }));
});
afterEach(async () => {
  if (prevHome === undefined) delete process.env.OBSIDIAN_BRIDGE_HOME;
  else process.env.OBSIDIAN_BRIDGE_HOME = prevHome;
  for (const c of cleanups.splice(0)) await c();
});

const creds = new MemoryCredentialStore();
const deps = (fetchImpl?: (u: string, i?: RequestInit) => Promise<Response>) => ({ credentials: creds, pdfHelper: "/nonexistent/pdf-text", version: "0.1.0", fetch: fetchImpl });
const tmp = async (p: string) => {
  const d = await realpath(await mkdtemp(join(tmpdir(), p)));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};

describe("setup wizard steps (used by the Menu Bar app)", () => {
  it("reports the system state before anything is set up", async () => {
    const r = await runWizard("system", {}, deps());
    expect(r).toMatchObject({ configured: false, paired: false, serviceRunning: false, pdfReader: false, node: { ok: true } });
  });
  it("validates a vault folder without changing it", async () => {
    const v = await makeVault();
    cleanups.push(v.cleanup);
    await v.write("a.md", NOTE(ID(1), true, "x"));
    expect(await runWizard("check-vault", { path: v.dir }, deps())).toMatchObject({ valid: true, readWrite: true, markdownFiles: 1 });
    const plain = await tmp("plain-");
    expect(await runWizard("check-vault", { path: plain }, deps())).toMatchObject({ valid: false, readWrite: false });
  });
  it("checks a backup folder: writable, not inside the vault, enough space", async () => {
    const v = await makeVault();
    cleanups.push(v.cleanup);
    const b = await tmp("bk-");
    const ok = await runWizard("check-backup", { path: b, vault: v.dir }, deps());
    expect(ok).toMatchObject({ writable: true, insideVault: false, enoughSpace: true });
    await mkdir(join(v.dir, "Backups"));
    expect(await runWizard("check-backup", { path: join(v.dir, "Backups"), vault: v.dir }, deps())).toMatchObject({ insideVault: true });
    expect(await runWizard("check-backup", { path: "/no/such/folder", vault: v.dir }, deps())).toMatchObject({ writable: false });
  });
  it("an external drive that is not there is reported as unavailable, not an error", async () => {
    expect(await runWizard("check-external", { path: "/Volumes/NotConnected" }, deps())).toMatchObject({ available: false });
  });
  it("pairs, stores the token in the credential store (never the config file) and writes a private config", async () => {
    const v = await makeVault();
    cleanups.push(v.cleanup);
    const b = await tmp("bk-");
    const calls: string[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(url).pathname}`);
      return Response.json({ device_id: "dev-123", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    };
    const r = await runWizard("pair", { url: "https://lifeos.example.com/", code: "K7QM-4XD2", vault: v.dir, backup: b, name: "James's Mac" }, deps(f));
    expect(r).toMatchObject({ paired: true, deviceId: "dev-123" });
    expect(calls).toEqual(["POST /api/obsidian/pair/complete"]);
    expect(await creds.get("dev-123")).toBe("tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    const file = join(home, "config.json");
    const text = await readFile(file, "utf8");
    expect(text).not.toContain("tok_ABC");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(text)).toMatchObject({ lifeosUrl: "https://lifeos.example.com", vaultPath: v.dir, backup: { localPath: b }, deviceId: "dev-123" });
    expect((await runWizard("state", {}, deps())).initialSyncConfirmed).toBe(false);
    expect((await runWizard("system", {}, deps()))).toMatchObject({ configured: true, paired: true });
  });
  it("shows the first-sync preview as numbers, and confirming is a separate step", async () => {
    const v = await makeVault();
    cleanups.push(v.cleanup);
    await v.write("a.md", NOTE(ID(1), true, "x"));
    await v.write("secret name.md", "local only");
    const b = await tmp("bk-");
    await runWizard("pair", { url: "https://l.example.com", code: "AAAA-BBBB", vault: v.dir, backup: b }, deps(async () => Response.json({ device_id: "d2", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" })));
    const p = await runWizard("preview", {}, deps());
    expect(p).toMatchObject({ eligibleNotes: 1, markdownFiles: 2 });
    expect(JSON.stringify(p)).not.toContain("secret name");
    expect((await runWizard("state", {}, deps())).initialSyncConfirmed).toBe(false);
    await runWizard("confirm", {}, deps());
    expect((await runWizard("state", {}, deps())).initialSyncConfirmed).toBe(true);
  });
  it("rejects a wrong code, a non-vault folder and unknown steps with a message", async () => {
    const v = await makeVault();
    cleanups.push(v.cleanup);
    const b = await tmp("bk-");
    await expect(runWizard("pair", { url: "https://l.example.com", code: "WRONG", vault: v.dir, backup: b }, deps(async () => Response.json({ error: "That pairing code is wrong, already used, or expired" }, { status: 400 })))).rejects.toThrow(/pairing code/);
    await expect(runWizard("pair", { url: "https://l.example.com", code: "X", vault: b, backup: b }, deps())).rejects.toThrow(/not an Obsidian vault/);
    await expect(runWizard("pair", { code: "X" }, deps())).rejects.toThrow(/Missing --url/);
    await expect(runWizard("nope", {}, deps())).rejects.toThrow(/Unknown wizard step/);
  });
});
