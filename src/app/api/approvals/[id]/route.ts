import { NextResponse } from "next/server";
import { z } from "zod";
import { api, notFound } from "@/lib/server/http";
import { getTzOffset } from "@/lib/server/env";
import { approvePending, rejectPending } from "@/lib/server/mcp/gate";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ decision: z.enum(["approve", "reject"]) });

export const POST = api<Ctx>(async (req, { params }) => {
  const { decision } = body.parse(await req.json());
  const id = (await params).id;
  const result = decision === "approve" ? await approvePending(id, await getTzOffset()) : await rejectPending(id);
  // null = already decided, expired or unknown
  return result ? NextResponse.json({ action: result }) : notFound();
});
