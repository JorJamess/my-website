import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { bumpSessionVersion, SESSION_COOKIE } from "@/lib/server/auth";

/** Log out of every device (this one included). */
export const POST = api(async () => {
  await bumpSessionVersion();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
