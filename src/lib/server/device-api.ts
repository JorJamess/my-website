import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { clientIp, lockedFor, recordFailure } from "@/lib/server/login-limit";
import { InputError } from "@/lib/server/repo";
import { checkDeviceToken, type ObsidianDevice } from "@/modules/obsidian/devices";
import { SyncRejected } from "@/modules/obsidian/documents";

type Handler<C> = (req: Request, ctx: C, device: ObsidianDevice) => Promise<Response>;

/**
 * Wrapper for the Obsidian Bridge's machine-to-machine endpoints. It does NOT use the browser cookie:
 * the Mac sends `Authorization: Bearer <device token>` and the token is checked on every request.
 * Browser same-origin checks do not apply here, and the owner-only `api()` wrapper is untouched.
 * Wrong tokens count against the same per-IP lockout used for login and MCP.
 */
export function deviceApi<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    // A valid token is never locked out. Only tokens we never issued count against the per-IP limit, and a token the
    // owner revoked does not (an old Bridge that keeps polling must not lock out a freshly paired one).
    const checked = await checkDeviceToken(token);
    if (!("device" in checked)) {
      const headers = { "WWW-Authenticate": 'Bearer realm="bridge"' };
      if (checked.reason === "revoked") return NextResponse.json({ error: "device_revoked" }, { status: 401, headers });
      const key = `bridge:${clientIp(req)}`;
      const wait = await lockedFor(key);
      if (wait) return NextResponse.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(wait) } });
      await recordFailure(key);
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }
    const device = checked.device;
    try {
      return await handler(req, ctx, device);
    } catch (err) {
      return deviceError(err);
    }
  };
}

export function deviceError(err: unknown) {
  if (err instanceof ZodError) return NextResponse.json({ error: "invalid_input", issues: err.issues }, { status: 400 });
  if (err instanceof SyncRejected) return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "revoked" || err.code === "stale_grant" ? 403 : err.code === "blocked_secret" ? 422 : err.code === "stale_version" ? 409 : 400 });
  if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[bridge]", err);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
