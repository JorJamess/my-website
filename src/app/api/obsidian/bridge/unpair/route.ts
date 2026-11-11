import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { logAudit } from "@/lib/server/repo";
import { revokeDevice } from "@/modules/obsidian/devices";

/** `obsidian-bridge unpair`: the Mac asks LifeOS to forget it. Its token stops working at once. */
export const POST = deviceApi(async (_req, _ctx, device) => {
  await revokeDevice(device.id);
  await logAudit({ actor: "you", action: "obsidian_device_unpaired", summary: "A paired Mac was unpaired from the Mac itself" });
  return NextResponse.json({ ok: true });
});
