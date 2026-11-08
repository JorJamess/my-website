import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createNote, listNotes } from "@/lib/server/repo";
import { noteCreateSchema } from "@/lib/schemas";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  const notes = await listNotes({
    q: p.get("q") || undefined,
    date: p.get("date") || undefined,
    eventId: p.get("event_id") || undefined,
  });
  return NextResponse.json({ notes });
});

export const POST = api(async (req) => {
  const input = noteCreateSchema.parse(await req.json());
  return NextResponse.json({ note: await createNote(input) }, { status: 201 });
});
