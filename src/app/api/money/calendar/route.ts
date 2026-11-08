import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getMoneyCalendar } from "@/lib/server/money";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  return NextResponse.json(await getMoneyCalendar(p.get("from") ?? "", p.get("to") ?? ""));
});
