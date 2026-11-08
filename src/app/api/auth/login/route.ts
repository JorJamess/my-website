import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE } from "@/lib/server/auth";
import { clearFailures, clientIp, lockedFor, recordFailure, waitMessage } from "@/lib/server/login-limit";

export async function POST(req: Request) {
  const ip = clientIp(req);

  const wait = await lockedFor(ip);
  if (wait) {
    return NextResponse.json({ error: waitMessage(wait) }, { status: 429, headers: { "Retry-After": String(wait) } });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || !(await checkPassword(body.password))) {
    const locked = await recordFailure(ip);
    await new Promise((r) => setTimeout(r, 600)); // หน่วงเล็กน้อยกันเดารหัส
    if (locked) {
      return NextResponse.json({ error: waitMessage(locked) }, { status: 429, headers: { "Retry-After": String(locked) } });
    }
    return NextResponse.json({ error: "That password isn't right. Try again" }, { status: 401 });
  }

  await clearFailures(ip);
  const { token, maxAge } = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
