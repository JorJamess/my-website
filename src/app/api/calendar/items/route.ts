import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getCalendarItems } from "@/lib/server/repo";

export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await getCalendarItems(q.get("from") ?? "", q.get("to") ?? ""));
});
