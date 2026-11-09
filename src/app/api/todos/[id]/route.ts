import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteTodo, getTodo, updateTodo } from "@/lib/server/repo";
import { todoUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const todo = await getTodo((await params).id);
  return todo ? NextResponse.json({ todo }) : notFound();
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = todoUpdateSchema.parse(await req.json());
  const todo = await updateTodo((await params).id, input);
  return todo ? NextResponse.json({ todo }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteTodo((await params).id)) ? NextResponse.json({ ok: true }) : notFound(),
);
