import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/lib/server/http";
import { logAudit } from "@/lib/server/repo";
import { setProposalsEnabled } from "@/modules/obsidian/documents";

/** The owner's switch for Claude's Obsidian proposals. Only the signed-in owner can change it; Claude cannot. */
export const POST = api(async (req) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await req.json());
  await setProposalsEnabled(enabled);
  await logAudit({ actor: "you", action: "obsidian_proposals", summary: enabled ? "Turned on Claude's Obsidian proposals" : "Turned off Claude's Obsidian proposals" });
  return NextResponse.json({ enabled });
});
