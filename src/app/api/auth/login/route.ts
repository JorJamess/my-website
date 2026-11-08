import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || !(await checkPassword(body.password))) {
    await new Promise((r) => setTimeout(r, 600)); // หน่วงเล็กน้อยกันเดารหัส
    return NextResponse.json({ error: "That password isn't right" }, { status: 401 });
  }
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
