import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createEvent, listEvents, searchEvents } from "@/lib/server/repo";
import { eventCreateSchema } from "@/lib/schemas";

export const GET = api(async (req) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = url.searchParams.get("q") ?? undefined;
  if (!from || !to) {
    if (q) return NextResponse.json({ events: await searchEvents(q) });
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  return NextResponse.json({ events: await listEvents({ from, to, q }) });
});

export const POST = api(async (req) => {
  const input = eventCreateSchema.parse(await req.json());
  return NextResponse.json({ event: await createEvent(input) }, { status: 201 });
});
