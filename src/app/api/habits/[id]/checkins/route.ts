import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { InputError, setCheckin } from "@/lib/server/repo";
import { checkinSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Tick or untick one day: PUT { day?, done?, note? } */
export const PUT = api<Ctx>(async (req, { params }) => {
  const input = checkinSchema.parse(await req.json().catch(() => ({})));
  try {
    const r = await setCheckin((await params).id, input);
    return NextResponse.json({ ok: true, day: r.day, done: r.done });
  } catch (err) {
    if (err instanceof InputError && err.message.startsWith("No habit")) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
});
