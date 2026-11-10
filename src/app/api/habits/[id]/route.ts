import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteHabit, getHabit, updateHabit } from "@/lib/server/repo";
import { habitUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const habit = await getHabit((await params).id);
  return habit ? NextResponse.json({ habit }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = habitUpdateSchema.parse(await req.json());
  const habit = await updateHabit((await params).id, input);
  return habit ? NextResponse.json({ habit }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteHabit((await params).id)) ? NextResponse.json({ ok: true }) : notFound(),
);
