import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";
import { getVisitStats } from "@/lib/analytics-core";

export const GET = api(async (req) => {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 14, 1), 90);
  return NextResponse.json(await getVisitStats((await getEnv()).DB, days));
});
