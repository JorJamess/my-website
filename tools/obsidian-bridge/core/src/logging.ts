import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

export type Logger = { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };

const SENSITIVE = /token|secret|password|authorization|content|payload|body|code/i;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** Never let a secret or note text reach a log: values under sensitive-looking keys are dropped. */
export function redact(fields: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  return out;
}

export function fileLogger(file: string, also?: (line: string) => void): Logger {
  let ready: Promise<unknown> | null = null;
  const write = (level: string, msg: string, f?: Record<string, unknown>) => {
    const line = `${new Date().toISOString()} ${level} ${msg}${f && Object.keys(f).length ? " " + JSON.stringify(redact(f)) : ""}`;
    also?.(line);
    ready = (ready ?? mkdir(dirname(file), { recursive: true, mode: 0o700 })).then(async () => {
      const s = await stat(file).catch(() => null);
      if (s && s.size > MAX_LOG_BYTES) await rename(file, `${file}.1`).catch(() => {});
      await appendFile(file, line + "\n", { mode: 0o600 });
    }).catch(() => {});
  };
  return { info: (m, f) => write("INFO", m, f), warn: (m, f) => write("WARN", m, f), error: (m, f) => write("ERROR", m, f) };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
