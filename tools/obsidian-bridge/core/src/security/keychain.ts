import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { SERVICE_NAME } from "../config/config.js";

const run = promisify(execFile);

/** Where the device token lives. On a Mac this is the Keychain; tests use memory. The token is never written to a file. */
export interface CredentialStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const SAFE = /^[A-Za-z0-9._:@-]+$/;

export class MacKeychain implements CredentialStore {
  constructor(private service = SERVICE_NAME) {}

  async get(account: string) {
    if (!SAFE.test(account)) throw new Error("Bad account name");
    try {
      const { stdout } = await run("security", ["find-generic-password", "-s", this.service, "-a", account, "-w"]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** The secret is sent on stdin to `security -i`, so it never appears in the process list. */
  async set(account: string, secret: string) {
    if (!SAFE.test(account) || !/^[A-Za-z0-9._~-]+$/.test(secret)) throw new Error("Bad credential characters");
    await new Promise<void>((resolve, reject) => {
      const p = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => (code === 0 && !err ? resolve() : reject(new Error(`Keychain write failed ${err.slice(0, 100)}`.trim()))));
      p.stdin.end(`add-generic-password -U -s ${this.service} -a ${account} -w ${secret}\n`);
    });
  }

  async delete(account: string) {
    if (!SAFE.test(account)) throw new Error("Bad account name");
    await run("security", ["delete-generic-password", "-s", this.service, "-a", account]).catch(() => {});
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private m = new Map<string, string>();
  async get(a: string) {
    return this.m.get(a) ?? null;
  }
  async set(a: string, s: string) {
    this.m.set(a, s);
  }
  async delete(a: string) {
    this.m.delete(a);
  }
}
