import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createFolder, listFolders } from "@/lib/server/repo";
import { folderSchema } from "@/lib/schemas";

export const GET = api(async () => NextResponse.json({ folders: await listFolders() }));

export const POST = api(async (req) => {
  const { name } = folderSchema.parse(await req.json());
  return NextResponse.json({ folder: await createFolder(name) }, { status: 201 });
});
