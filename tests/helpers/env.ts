import { createTestDb } from "./d1";

/** Fresh database + fake env for one test. */
export function freshEnv(extra: Record<string, unknown> = {}) {
  const env = { DB: createTestDb(), ...extra };
  (globalThis as unknown as { __testEnv: unknown }).__testEnv = env;
  return env as unknown as CloudflareEnv;
}
