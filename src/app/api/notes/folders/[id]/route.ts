import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { deleteFolder, renameFolder } from "@/lib/server/repo";
import { folderSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { name } = folderSchema.parse(await req.json());
  const folder = await renameFolder((await params).id, name);
  return folder ? NextResponse.json({ folder }) : notFound();
});

export const DELETE = api<Ctx>(async (_req, { params }) =>
  (await deleteFolder((await params).id)) ? NextResponse.json({ ok: true }) : notFound(),
);
