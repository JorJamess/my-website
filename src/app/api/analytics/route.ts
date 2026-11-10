import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getAnalytics } from "@/lib/server/repo";

export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams;
  const range = q.get("range") === "month" ? "month" : "week";
  const offset = Math.trunc(Number(q.get("offset") ?? 0)) || 0;
  return NextResponse.json(await getAnalytics({ range, offset }));
});
