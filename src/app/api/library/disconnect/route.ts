import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { disconnect } from "@/lib/server/google-drive";

/** Forget the Google connection (and revoke it at Google). Files in Drive are untouched. */
export const POST = api(async () => {
  await disconnect();
  return NextResponse.json({ ok: true });
});
