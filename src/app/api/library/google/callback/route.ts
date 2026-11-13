import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed, safeEqual } from "@/lib/server/auth";
import { DriveError, finishConnect } from "@/lib/server/google-drive";

export const dynamic = "force-dynamic";

const back = (req: Request, q: string) => NextResponse.redirect(new URL(`/app/library?${q}`, req.url));

/** Google sends the owner back here with a one-time code. */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/app", req.url));
  const url = new URL(req.url);
  const store = await cookies();
  const expected = store.get("g_oauth_state")?.value;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const googleError = url.searchParams.get("error");
  const clear = (res: NextResponse) => {
    res.cookies.delete({ name: "g_oauth_state", path: "/api/library/google" });
    return res;
  };

  if (googleError) return clear(back(req, `error=${encodeURIComponent(googleError)}`));
  if (!expected || !state || !safeEqual(expected, state) || !code) return clear(back(req, "error=bad_state"));
  try {
    const { folder } = await finishConnect(req, code);
    return clear(back(req, folder ? "connected=1" : "connected=1&nofolder=1"));
  } catch (err) {
    console.error(err);
    return clear(back(req, `error=${encodeURIComponent(err instanceof DriveError ? err.message : "server_error")}`));
  }
}
