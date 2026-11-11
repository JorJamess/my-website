import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listDocuments, type DocStatus } from "@/modules/obsidian/documents";

export const GET = api(async (req) => {
  const status = new URL(req.url).searchParams.get("status") as DocStatus | null;
  return NextResponse.json({ documents: await listDocuments({ status: status ?? undefined }) });
});
