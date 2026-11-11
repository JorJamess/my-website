import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { reconcileAfterRestore } from "@/modules/obsidian/documents";

/** Run after any database rollback (e.g. D1 Time Travel): re-applies revocations and rebuilds the search index. */
export const POST = api(async () => {
  await reconcileAfterRestore();
  return NextResponse.json({ ok: true });
});
