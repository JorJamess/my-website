import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshEnv } from "./helpers/env";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "mw_session" && cookieValue ? { value: cookieValue } : undefined) }),
}));

import { bumpSessionVersion, createSessionToken, getSessionVersion, isAuthed } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/origin";
import { mcpGate } from "@/lib/server/mcp/guard";

const secrets = { SESSION_SECRET: "s".repeat(32), MCP_TOKEN: "t".repeat(24) };
beforeEach(() => {
  cookieValue = undefined;
  freshEnv(secrets);
});

describe("log out everywhere (session version)", () => {
  it("starts at 1 and increments", async () => {
    const env = freshEnv(secrets);
    expect(await getSessionVersion(env.DB)).toBe(1);
    expect(await bumpSessionVersion()).toBe(2);
    expect(await getSessionVersion(env.DB)).toBe(2);
  });
  it("kills sessions issued before the bump but not new ones", async () => {
    cookieValue = (await createSessionToken()).token;
    expect(await isAuthed()).toBe(true);
    await bumpSessionVersion();
    expect(await isAuthed()).toBe(false);
    cookieValue = (await createSessionToken()).token;
    expect(await isAuthed()).toBe(true);
  });
  it("rejects old three-part tokens", async () => {
    cookieValue = "admin.9999999999999.abc";
    expect(await isAuthed()).toBe(false);
  });
});

describe("same-origin guard", () => {
  const req = (method: string, origin?: string) =>
    new Request("https://site.example/api/events", { method, headers: origin ? { origin } : {} });
  it("always allows reads", () => {
    expect(isSameOrigin(req("GET", "https://evil.example"))).toBe(true);
  });
  it("allows writes from our own origin and from non-browser clients", () => {
    expect(isSameOrigin(req("POST", "https://site.example"))).toBe(true);
    expect(isSameOrigin(req("POST"))).toBe(true);
  });
  it("blocks writes from another origin or a garbage origin", () => {
    expect(isSameOrigin(req("POST", "https://evil.example"))).toBe(false);
    expect(isSameOrigin(req("DELETE", "https://site.example.evil.com"))).toBe(false);
    expect(isSameOrigin(req("PATCH", "null"))).toBe(false);
  });
});

describe("MCP token gate", () => {
  const call = (ip: string) => new Request("https://site.example/api/mcp", { method: "POST", headers: { "cf-connecting-ip": ip } });
  it("lets the right token through", async () => {
    expect(await mcpGate(call("9.9.9.9"), "t".repeat(24))).toBeNull();
  });
  it("answers 401 for a wrong token", async () => {
    expect((await mcpGate(call("9.9.9.9"), "nope"))?.status).toBe(401);
  });
  it("locks an IP after repeated wrong tokens, even for the right token afterwards", async () => {
    for (let i = 0; i < 5; i++) await mcpGate(call("8.8.8.8"), "wrong");
    expect((await mcpGate(call("8.8.8.8"), "t".repeat(24)))?.status).toBe(429);
    expect(await mcpGate(call("7.7.7.7"), "t".repeat(24))).toBeNull();
  });
});
