import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { removeDocument, updatePath } from "@/modules/obsidian/documents";
import { pathSchema } from "@/modules/obsidian/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** The note was deleted on the Mac: remove the cloud copy. */
export const DELETE = deviceApi<Ctx>(async (_req, { params }) => {
  await removeDocument((await params).id);
  return NextResponse.json({ ok: true });
});

/** The note was renamed or moved on the Mac. */
export const PATCH = deviceApi<Ctx>(async (req, { params }) => {
  const body = pathSchema.parse(await req.json());
  const ok = await updatePath((await params).id, body.path, body.title);
  return NextResponse.json({ ok });
});
