import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { reportResult } from "@/modules/obsidian/commands";
import { resultSchema } from "@/modules/obsidian/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = deviceApi<Ctx>(async (req, { params }, device) => {
  const out = await reportResult(device.id, (await params).id, resultSchema.parse(await req.json()));
  return out ? NextResponse.json(out) : NextResponse.json({ error: "not_claimed_by_this_device" }, { status: 409 });
});
