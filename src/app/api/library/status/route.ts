import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";
import { getConnection } from "@/lib/server/google-drive";

export const GET = api(async () => {
  const env = await getEnv();
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const conn = configured ? await getConnection() : null;
  return NextResponse.json({ configured, connected: !!conn, folderId: conn?.folderId ?? null, folderName: conn?.folderName ?? null });
});
