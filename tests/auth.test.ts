import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshEnv } from "./helpers/env";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "mw_session" && cookieValue ? { value: cookieValue } : undefined) }),
}));

import { checkMcpToken, checkPassword, createSessionToken, isAuthed, safeEqual } from "@/lib/server/auth";

beforeEach(() => {
  cookieValue = undefined;
  freshEnv({ SESSION_SECRET: "s".repeat(32), ADMIN_PASSWORD: "correct horse", MCP_TOKEN: "t".repeat(24) });
});

describe("session cookie", () => {
  it("accepts a token it created", async () => {
    cookieValue = (await createSessionToken()).token;
    expect(await isAuthed()).toBe(true);
  });
  it("rejects a missing cookie", async () => {
    expect(await isAuthed()).toBe(false);
  });
  it("rejects a tampered signature or payload", async () => {
    const { token } = await createSessionToken();
    const [who, exp, ver, sig] = token.split(".");
    cookieValue = `${who}.${exp}.${ver}.${sig.slice(0, -2)}xx`;
    expect(await isAuthed()).toBe(false);
    cookieValue = `${who}.${Number(exp) + 1000}.${ver}.${sig}`;
    expect(await isAuthed()).toBe(false);
  });
  it("rejects an expired token", async () => {
    const { token } = await createSessionToken();
    const [who, , ver, sig] = token.split(".");
    cookieValue = `${who}.${Date.now() - 1000}.${ver}.${sig}`;
    expect(await isAuthed()).toBe(false);
  });
  it("rejects a token signed with another secret", async () => {
    const { token } = await createSessionToken();
    freshEnv({ SESSION_SECRET: "x".repeat(32) });
    cookieValue = token;
    expect(await isAuthed()).toBe(false);
  });
});

describe("password and MCP token", () => {
  it("checks the password", async () => {
    expect(await checkPassword("correct horse")).toBe(true);
    expect(await checkPassword("wrong")).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });
  it("fails closed when secrets are missing", async () => {
    freshEnv({});
    expect(await checkPassword("anything")).toBe(false);
    expect(await checkMcpToken("anything")).toBe(false);
  });
  it("requires a long enough MCP token", async () => {
    expect(await checkMcpToken("t".repeat(24))).toBe(true);
    expect(await checkMcpToken("t".repeat(23))).toBe(false);
    freshEnv({ MCP_TOKEN: "short" });
    expect(await checkMcpToken("short")).toBe(false);
  });
  it("compares strings of different length safely", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});
