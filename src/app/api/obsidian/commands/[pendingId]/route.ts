import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { previewCommand } from "@/modules/obsidian/commands";

type Ctx = { params: Promise<{ pendingId: string }> };

/** The exact proposal (path, full content or diff) for the owner to read before approving. */
export const GET = api<Ctx>(async (_req, { params }) => {
  const p = await previewCommand((await params).pendingId);
  return p ? NextResponse.json(p) : notFound();
});
