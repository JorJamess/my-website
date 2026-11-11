import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeService } from "../src/service/daemon.js";
import { MemoryCredentialStore } from "../src/security/keychain.js";
import { emptyState } from "../src/sync/state.js";
import { silentLogger } from "../src/logging.js";
import { createPdfExtractor } from "../src/pdf/extract.js";
import { ID, makeVault, NATIVE, NOTE } from "./helpers/vault.js";

const BIN = join(__dirname, "../../macos/.build/release/ObsidianBridgeMenu");
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

// The Menu Bar app's socket client talking to the real Core service.
describe.skipIf(process.platform !== "darwin" || !existsSync(BIN))("menu bar app ↔ Core", () => {
  it("reads the live status over the private socket", async () => {
    const v = await makeVault();
    const home = await realpath(await mkdtemp(join(tmpdir(), "mb-")));
    cleanups.push(v.cleanup, () => rm(home, { recursive: true, force: true }));
    await v.write("a.md", NOTE(ID(1), true, "hello"));
    const creds = new MemoryCredentialStore();
    await creds.set("dev1", "token-token-token-token-1");
    const svc = new BridgeService({
      cfg: { version: 1, lifeosUrl: "https://x.test", vaultPath: v.dir, vaultName: "T", deviceName: "M", deviceId: "dev1", backup: { localPath: null, externalPath: null }, trashFolder: ".trash", pollSeconds: 15, pdfMaxBytes: 1e8, initialSyncConfirmedAt: new Date().toISOString() },
      configFile: join(home, "config.json"), stateFile: join(home, "state.json"), socketPath: join(home, "b.sock"), state: emptyState(), credentials: creds,
      extractPdf: createPdfExtractor(join(NATIVE, "pdf-text")), log: silentLogger,
      fetch: async (url) => Response.json(String(url).includes("/poll") ? { now: "x", cursor: "1970-01-01T00:00:00.000Z", paused: false, sync_requested: false, awaiting_approval: 3, commands: [], revocations: [], exceptions: [] } : { ok: true, status: "synced", received: 0, expected: 0 }),
      debounceMs: 20, reconcileEveryMs: 3_600_000, wakeCheckMs: 3_600_000,
    });
    await svc.start();
    cleanups.push(() => svc.stop());
    await new Promise((r) => setTimeout(r, 400));
    // run the app's client in a separate process (execFile would block the event loop the service runs on)
    const { execFile } = await import("node:child_process");
    const out = await new Promise<string>((resolve, reject) => execFile(BIN, ["--print-status", join(home, "b.sock")], (e, stdout) => (e ? reject(e) : resolve(stdout))));
    const status = JSON.parse(out) as Record<string, unknown>;
    expect(status).toMatchObject({ running: true, online: true, paused: false, initialSyncConfirmed: true, awaitingApproval: 3, pollSeconds: 15 });
    expect((status.backup as { configured: boolean }).configured).toBe(false);
    void execFileSync;
  });
  it("reports a clear error when the service is not running", () => {
    let out = "";
    try {
      execFileSync(BIN, ["--print-status", "/tmp/nonexistent-bridge.sock"], { encoding: "utf8" });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    expect(JSON.parse(out)).toMatchObject({ error: expect.stringMatching(/not running/) });
  });
});
