import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteGoal, getGoalDetail, listCategories, updateGoal } from "@/lib/server/repo";
import { goalUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const goal = await getGoalDetail((await params).id);
  return goal ? NextResponse.json({ goal, categories: await listCategories("goal") }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = goalUpdateSchema.parse(await req.json());
  const goal = await updateGoal((await params).id, input);
  return goal ? NextResponse.json({ goal }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteGoal((await params).id)) ? NextResponse.json({ ok: true }) : notFound(),
);
