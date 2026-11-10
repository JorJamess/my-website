import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteMilestone, updateMilestone } from "@/lib/server/repo";
import { milestoneUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string; mid: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = milestoneUpdateSchema.parse(await req.json());
  const milestone = await updateMilestone((await params).mid, input);
  return milestone ? NextResponse.json({ milestone }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteMilestone((await params).mid)) ? NextResponse.json({ ok: true }) : notFound(),
);
