import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { pollCommands } from "@/modules/obsidian/commands";
import { exceptionsSince, revocationsSince } from "@/modules/obsidian/documents";

/**
 * Called by the Bridge every 15 seconds. Reads only; the heartbeat time is written at most every 5 minutes.
 * Query: rev_since, exc_since (ISO times from the previous response's `now`).
 */
export const GET = deviceApi(async (req, _ctx, device) => {
  const url = new URL(req.url);
  const rev = url.searchParams.get("rev_since") ?? "1970-01-01T00:00:00.000Z";
  const exc = url.searchParams.get("exc_since") ?? "1970-01-01T00:00:00.000Z";
  const now = new Date().toISOString();
  const [commands, revocations, exceptions] = await Promise.all([pollCommands(), revocationsSince(rev), exceptionsSince(exc)]);
  return NextResponse.json({ now, paused: device.paused, sync_requested: !!device.sync_requested_at, commands, revocations, exceptions });
});
