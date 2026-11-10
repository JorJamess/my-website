import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { addMilestone } from "@/lib/server/repo";
import { milestoneCreateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  const input = milestoneCreateSchema.parse(await req.json());
  return NextResponse.json({ milestone: await addMilestone((await params).id, input) }, { status: 201 });
});
