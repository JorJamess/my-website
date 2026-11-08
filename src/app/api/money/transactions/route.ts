import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getMoneyTransactions } from "@/lib/server/money";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200);
  return NextResponse.json({ transactions: await getMoneyTransactions(p.get("from") ?? "", p.get("to") ?? "", limit) });
});
