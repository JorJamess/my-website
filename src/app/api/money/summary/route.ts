import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getMoneySummary } from "@/lib/server/money";

export const GET = api(async (req) => {
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return NextResponse.json(await getMoneySummary(month));
});
