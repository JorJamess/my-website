import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteNote, getNoteDetail, updateNote } from "@/lib/server/repo";
import { noteUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const note = await getNoteDetail((await params).id);
  return note ? NextResponse.json({ note }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = noteUpdateSchema.parse(await req.json());
  const id = (await params).id;
  const note = await updateNote(id, input);
  return note ? NextResponse.json({ note }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  return (await deleteNote((await params).id)) ? NextResponse.json({ ok: true }) : notFound();
});
