import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createHabit, getHabitsOverview } from "@/lib/server/repo";
import { habitCreateSchema } from "@/lib/schemas";

export const GET = api(async (req) => {
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  return NextResponse.json({ habits: await getHabitsOverview({ includeArchived }) });
});

export const POST = api(async (req) => {
  const input = habitCreateSchema.parse(await req.json());
  return NextResponse.json({ habit: await createHabit(input) }, { status: 201 });
});
