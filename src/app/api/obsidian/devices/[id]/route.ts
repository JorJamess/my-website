import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { logAudit } from "@/lib/server/repo";
import { requestSync, revokeDevice, setPaused } from "@/modules/obsidian/devices";
import { deviceActionSchema } from "@/modules/obsidian/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  const { action } = deviceActionSchema.parse(await req.json());
  const id = (await params).id;
  const ok = action === "revoke" ? await revokeDevice(id) : action === "pause" ? await setPaused(id, true) : action === "resume" ? await setPaused(id, false) : await requestSync(id);
  if (!ok) return notFound();
  if (action === "revoke") await logAudit({ actor: "you", action: "obsidian_device_revoked", summary: "Revoked a paired Mac" });
  return NextResponse.json({ ok: true });
});
