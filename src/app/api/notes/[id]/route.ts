import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteNote, getNote, updateNote } from "@/lib/server/repo";
import { noteUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const note = await getNote((await params).id);
  return note ? NextResponse.json({ note }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = noteUpdateSchema.parse(await req.json());
  const note = await updateNote((await params).id, input);
  return note ? NextResponse.json({ note }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  return (await deleteNote((await params).id)) ? NextResponse.json({ ok: true }) : notFound();
});
