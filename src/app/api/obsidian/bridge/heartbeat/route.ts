import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { clearSyncRequest } from "@/modules/obsidian/devices";
import { touchSyncState } from "@/modules/obsidian/documents";
import { heartbeatSchema } from "@/modules/obsidian/schemas";

/** The Bridge reports its state when it changes (not every poll). Counters only, never note names or content. */
export const POST = deviceApi(async (req, _ctx, device) => {
  const b = heartbeatSchema.parse(await req.json());
  await touchSyncState(device.id, b.status, !!b.success, b.error, b.details);
  if (b.sync_request_seen) await clearSyncRequest(device.id);
  return NextResponse.json({ ok: true });
});
