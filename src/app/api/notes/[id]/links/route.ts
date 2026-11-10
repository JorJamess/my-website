import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { getNoteDetail, linkNote, unlinkNote } from "@/lib/server/repo";
import { noteLinkSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  await linkNote(id, noteLinkSchema.parse(await req.json()));
  const note = await getNoteDetail(id);
  return note ? NextResponse.json({ note }) : notFound();
});

export const DELETE = api<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  await unlinkNote(id, noteLinkSchema.parse(await req.json()));
  const note = await getNoteDetail(id);
  return note ? NextResponse.json({ note }) : notFound();
});
