import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { upload } from "@/modules/obsidian/documents";
import { uploadSchema } from "@/modules/obsidian/schemas";

/** Upload one document (or one part of it). Refused if revoked, stale, or the text contains a possible secret. */
export const POST = deviceApi(async (req, _ctx, device) => {
  const body = uploadSchema.parse(await req.json());
  return NextResponse.json(await upload(device.id, body));
});
