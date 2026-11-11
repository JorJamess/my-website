import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { reenableDocument, revokeDocument } from "@/modules/obsidian/documents";
import { revokeSchema } from "@/modules/obsidian/schemas";

type Ctx = { params: Promise<{ id: string; action: string }> };

/** Emergency revoke / re-enable. Revoke works even when the Mac is off. */
export const POST = api<Ctx>(async (req, { params }) => {
  const { id, action } = await params;
  if (action === "revoke") {
    const body = revokeSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await revokeDocument(id, body.reason));
  }
  if (action === "reenable") return NextResponse.json(await reenableDocument(id));
  return notFound();
});
