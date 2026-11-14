import "server-only";
import { checkMcpScope, checkMcpToken } from "@/lib/server/auth";
import { clientIp, lockedFor, recordFailure } from "@/lib/server/login-limit";
import { unauthorized } from "./handler";

/**
 * Check an MCP token. Too many wrong tries from one IP lock that IP out for a while
 * (same limiter as the login form, keyed separately).
 * Returns null when the token is fine, or a Response to send back.
 */
export async function mcpGate(req: Request, token: string | null | undefined): Promise<Response | null> {
  const key = `mcp:${clientIp(req)}`;
  const wait = await lockedFor(key);
  if (wait) return new Response(JSON.stringify({ error: "too_many_attempts" }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(wait) } });
  if (await checkMcpToken(token)) return null;
  await recordFailure(key);
  return unauthorized();
}

/**
 * Like mcpGate, but also says what the token may do: "full" (MCP_TOKEN) or "read" (MCP_READ_TOKEN).
 * Same per-IP lockout. Returns the scope, or a Response to send back.
 */
export async function mcpGateScope(req: Request, token: string | null | undefined): Promise<{ scope: "full" | "read" } | Response> {
  const key = `mcp:${clientIp(req)}`;
  const wait = await lockedFor(key);
  if (wait) return new Response(JSON.stringify({ error: "too_many_attempts" }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(wait) } });
  const scope = await checkMcpScope(token);
  if (scope) return { scope };
  await recordFailure(key);
  return unauthorized();
}
