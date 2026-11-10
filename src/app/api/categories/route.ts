import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createCategory, listCategories } from "@/lib/server/repo";
import { categorySchema } from "@/lib/schemas";

export const GET = api(async () => NextResponse.json({ categories: await listCategories() }));

export const POST = api(async (req) => {
  const input = categorySchema.parse(await req.json());
  return NextResponse.json({ category: await createCategory(input) }, { status: 201 });
});
