import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createTodo, listTodos } from "@/lib/server/repo";
import { todoCreateSchema } from "@/lib/schemas";

export const GET = api(async (req) => {
  const includeDone = new URL(req.url).searchParams.get("done") === "1";
  return NextResponse.json({ todos: await listTodos({ includeDone }) });
});

export const POST = api(async (req) => {
  const input = todoCreateSchema.parse(await req.json());
  return NextResponse.json({ todo: await createTodo(input) }, { status: 201 });
});
