import { vi } from "vitest";

// Every test file gets the fake env from globalThis.__testEnv (set by freshEnv()).
vi.mock("@/lib/server/env", () => ({
  getEnv: async () => (globalThis as unknown as { __testEnv: unknown }).__testEnv,
  getTzOffset: async () => "+07:00",
}));
