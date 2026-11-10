import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { linkToGoal, unlinkFromGoal } from "@/lib/server/repo";
import { goalLinkSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  await linkToGoal((await params).id, goalLinkSchema.parse(await req.json()));
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = api<Ctx>(async (req, { params }) => {
  const input = goalLinkSchema.parse(await req.json());
  return (await unlinkFromGoal((await params).id, input)) ? NextResponse.json({ ok: true }) : notFound();
});
