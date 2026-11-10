import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createGoal, listCategories, listGoals } from "@/lib/server/repo";
import { goalCreateSchema } from "@/lib/schemas";
import { GOAL_STATUSES, type GoalStatus } from "@/lib/types";

export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const goals = await listGoals({
    status: (GOAL_STATUSES as readonly string[]).includes(status ?? "") ? (status as GoalStatus) : undefined,
    includeInactive: q.get("all") === "1",
  });
  return NextResponse.json({ goals, categories: await listCategories("goal") });
});

export const POST = api(async (req) => {
  const input = goalCreateSchema.parse(await req.json());
  return NextResponse.json({ goal: await createGoal(input) }, { status: 201 });
});
