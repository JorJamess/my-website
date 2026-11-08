import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listMessages } from "@/lib/server/messages";

export const GET = api(async (req) => {
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  return NextResponse.json(await listMessages({ unreadOnly, limit: 50 }));
});
