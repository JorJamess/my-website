import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshEnv } from "./helpers/env";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { checkMcpScope } from "@/lib/server/auth";
import { mcpGateScope } from "@/lib/server/mcp/guard";
import { handleMcpPost } from "@/lib/server/mcp/handler";
import { toolList } from "@/lib/server/mcp/tools";

// dummy test values only
const FULL = "f".repeat(24);
const READ = "r".repeat(24);

beforeEach(() => {
  freshEnv({ MCP_TOKEN: FULL, MCP_READ_TOKEN: READ });
});

const post = (ip: string) => new Request("https://site.example/api/mcp", { method: "POST", headers: { "cf-connecting-ip": ip } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(scope: "full" | "read", method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await handleMcpPost(
    new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
    scope,
  );
  return res.json();
}

describe("checkMcpScope", () => {
  it("maps each token to its scope", async () => {
    expect(await checkMcpScope(FULL)).toBe("full");
    expect(await checkMcpScope(READ)).toBe("read");
    expect(await checkMcpScope("x".repeat(24))).toBeNull();
    expect(await checkMcpScope(null)).toBeNull();
  });
  it("ignores a read token that is too short, missing, or equal to the full token", async () => {
    freshEnv({ MCP_TOKEN: FULL, MCP_READ_TOKEN: "short" });
    expect(await checkMcpScope("short")).toBeNull();
    freshEnv({ MCP_TOKEN: FULL });
    expect(await checkMcpScope(READ)).toBeNull();
    freshEnv({ MCP_TOKEN: FULL, MCP_READ_TOKEN: FULL });
    expect(await checkMcpScope(FULL)).toBe("full");
  });
});

describe("mcpGateScope", () => {
  it("returns the scope for good tokens and 401 for bad ones", async () => {
    expect(await mcpGateScope(post("1.1.1.1"), FULL)).toEqual({ scope: "full" });
    expect(await mcpGateScope(post("1.1.1.1"), READ)).toEqual({ scope: "read" });
    const bad = await mcpGateScope(post("1.1.1.1"), "nope");
    expect(bad instanceof Response && bad.status).toBe(401);
  });
  it("locks an IP after repeated wrong tokens", async () => {
    for (let i = 0; i < 5; i++) await mcpGateScope(post("2.2.2.2"), "wrong");
    const locked = await mcpGateScope(post("2.2.2.2"), READ);
    expect(locked instanceof Response && locked.status).toBe(429);
  });
});

describe("read-only scope", () => {
  it("lists only read-only tools and hides message/visitor tools", async () => {
    const body = await rpc("read", "tools/list");
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain("get_summary");
    for (const n of ["create_todo", "update_todo", "delete_note", "check_in_habit", "mark_message_read", "list_messages", "get_portfolio_stats"]) {
      expect(names).not.toContain(n);
    }
    const all = toolList();
    for (const t of body.result.tools) {
      expect(all.find((a) => a.name === t.name)?.annotations?.readOnlyHint).toBe(true);
    }
  });
  it("refuses a write tool called by name and writes nothing", async () => {
    const body = await rpc("read", "tools/call", { name: "create_todo", arguments: { title: "should not exist" } });
    expect(body.error?.message).toMatch(/read-only/);
    const list = await rpc("full", "tools/call", { name: "list_todos", arguments: {} });
    expect(JSON.stringify(list)).not.toContain("should not exist");
  });
  it("refuses message tools even though they are read-only", async () => {
    const body = await rpc("read", "tools/call", { name: "list_messages", arguments: {} });
    expect(body.error?.message).toMatch(/read-only/);
  });
  it("still runs a read tool", async () => {
    const body = await rpc("read", "tools/call", { name: "get_summary", arguments: {} });
    expect(body.result?.isError).toBeUndefined();
    expect(body.result.content[0].text).toBeTruthy();
  });
});

describe("full scope is unchanged", () => {
  it("lists every tool and can create", async () => {
    const body = await rpc("full", "tools/list");
    expect(body.result.tools.length).toBe(toolList().length);
    const made = await rpc("full", "tools/call", { name: "create_todo", arguments: { title: "ok" } });
    expect(made.result.content[0].text).toContain("created");
  });
});
