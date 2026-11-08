import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteEvent, getEvent, updateEvent } from "@/lib/server/repo";
import { eventUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const event = await getEvent((await params).id);
  return event ? NextResponse.json({ event }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = eventUpdateSchema.parse(await req.json());
  const event = await updateEvent((await params).id, input);
  return event ? NextResponse.json({ event }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  return (await deleteEvent((await params).id)) ? NextResponse.json({ ok: true }) : notFound();
});
