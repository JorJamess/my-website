import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { reportBlocked } from "@/modules/obsidian/documents";
import { blockedSchema } from "@/modules/obsidian/schemas";

/** The Mac held a note back because of the secret scan. Only title, path and masked findings are sent. */
export const POST = deviceApi(async (req, _ctx, device) => {
  await reportBlocked(device.id, blockedSchema.parse(await req.json()));
  return NextResponse.json({ ok: true });
});
