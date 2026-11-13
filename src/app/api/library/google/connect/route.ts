import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/server/auth";
import { buildAuthUrl, DriveError } from "@/lib/server/google-drive";

export const dynamic = "force-dynamic";

/** Browser navigation (not fetch): send the signed-in owner to Google's consent page. */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/app", req.url));
  try {
    const state = crypto.randomUUID();
    const res = NextResponse.redirect(await buildAuthUrl(req, state));
    res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: new URL(req.url).protocol === "https:", sameSite: "lax", path: "/api/library/google", maxAge: 600 });
    return res;
  } catch (err) {
    const msg = err instanceof DriveError ? err.message : "server_error";
    return NextResponse.redirect(new URL(`/app/library?error=${encodeURIComponent(msg)}`, req.url));
  }
}
