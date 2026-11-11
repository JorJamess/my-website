import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { countAwaitingApproval, pollCommands } from "@/modules/obsidian/commands";
import { exceptionsSince, revocationsSince } from "@/modules/obsidian/documents";

const CURSOR_OVERLAP_MS = 60_000;

/**
 * Called by the Bridge every 15 seconds. Reads only; the heartbeat time is written at most every 5 minutes.
 * Query: rev_since, exc_since (the `cursor` from the previous response; omit them to get everything).
 */
export const GET = deviceApi(async (req, _ctx, device) => {
  const url = new URL(req.url);
  const rev = url.searchParams.get("rev_since") ?? "1970-01-01T00:00:00.000Z";
  const exc = url.searchParams.get("exc_since") ?? "1970-01-01T00:00:00.000Z";
  const now = new Date();
  const [commands, revocations, exceptions, awaiting] = await Promise.all([pollCommands(), revocationsSince(rev), exceptionsSince(exc), countAwaitingApproval()]);
  // Use `cursor` (not `now`) as the next rev_since / exc_since. It lags by a minute because a change is stamped just
  // before it is committed; re-reading that minute is harmless (the Bridge applies each change idempotently) and
  // guarantees a revocation that committed a moment after this read is never skipped.
  const cursor = new Date(now.getTime() - CURSOR_OVERLAP_MS).toISOString();
  return NextResponse.json({ now: now.toISOString(), cursor, paused: device.paused, sync_requested: !!device.sync_requested_at, awaiting_approval: awaiting, commands, revocations, exceptions });
});
