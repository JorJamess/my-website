import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { claimCommand } from "@/modules/obsidian/commands";

type Ctx = { params: Promise<{ id: string }> };

/** Take an approved command (once). Returns the decrypted proposal, or 409 if it is gone, expired or taken. */
export const POST = deviceApi<Ctx>(async (_req, { params }, device) => {
  const cmd = await claimCommand(device.id, (await params).id);
  return cmd ? NextResponse.json(cmd) : NextResponse.json({ error: "not_available" }, { status: 409 });
});
