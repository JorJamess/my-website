import { NextResponse } from "next/server";
import { clientIp, lockedFor, recordFailure } from "@/lib/server/login-limit";
import { errorResponse } from "@/lib/server/http";
import { InputError } from "@/lib/server/repo";
import { completePairing } from "@/modules/obsidian/devices";
import { pairCompleteSchema } from "@/modules/obsidian/schemas";

/** The Bridge trades the code for a device token. No cookie; wrong codes are rate-limited per IP. */
export async function POST(req: Request) {
  const key = `pair:${clientIp(req)}`;
  const wait = await lockedFor(key);
  if (wait) return NextResponse.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(wait) } });
  try {
    const body = pairCompleteSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await completePairing(body));
  } catch (err) {
    if (err instanceof InputError) {
      await recordFailure(key);
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}
