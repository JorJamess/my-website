import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteCategory, updateCategory } from "@/lib/server/repo";
import { categorySchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const input = categorySchema.partial().parse(await req.json());
  const category = await updateCategory((await params).id, input);
  return category ? NextResponse.json({ category }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteCategory((await params).id)) ? NextResponse.json({ ok: true }) : notFound(),
);
