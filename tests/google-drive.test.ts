import { describe, expect, it } from "vitest";

// google-drive.ts imports "server-only"; stub it for the test runner
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/env", () => ({ getEnv: async () => ({}) }));

const { encryptToken, decryptToken, isValidId } = await import("@/lib/server/google-drive");

describe("google drive helpers", () => {
  it("encrypts a refresh token so it can only be read back with the same secret", async () => {
    const stored = await encryptToken("1//refresh-token-value", "secret-a");
    expect(stored).not.toContain("refresh-token-value");
    expect(await decryptToken(stored, "secret-a")).toBe("1//refresh-token-value");
    await expect(decryptToken(stored, "secret-b")).rejects.toThrow();
  });

  it("uses a fresh iv every time", async () => {
    expect(await encryptToken("x", "s")).not.toBe(await encryptToken("x", "s"));
  });

  it("only accepts Drive-looking ids (no query injection through the url)", () => {
    expect(isValidId("1AbC_dEf-gHiJkLmNoPqRs")).toBe(true);
    expect(isValidId("a' in parents or '")).toBe(false);
    expect(isValidId("../../etc")).toBe(false);
    expect(isValidId("")).toBe(false);
  });
});
