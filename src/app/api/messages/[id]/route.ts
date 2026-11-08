import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteMessage, setMessageRead } from "@/lib/server/messages";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { read } = (await req.json()) as { read?: boolean };
  return (await setMessageRead((await params).id, read !== false)) ? NextResponse.json({ ok: true }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  return (await deleteMessage((await params).id)) ? NextResponse.json({ ok: true }) : notFound();
});
