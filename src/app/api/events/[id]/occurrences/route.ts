import { NextResponse } from "next/server";
import { z } from "zod";
import { api, notFound } from "@/lib/server/http";
import { detachOccurrence, getEvent, restoreOccurrence, skipOccurrence } from "@/lib/server/repo";
import { eventCreateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip"), day }),
  z.object({ action: z.literal("restore"), day }),
  /** "edit just this one": becomes its own event with these details */
  z.object({ action: z.literal("edit"), day, event: eventCreateSchema }),
]);

export const POST = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!(await getEvent(id))) return notFound();
  const input = body.parse(await req.json());
  if (input.action === "skip") {
    await skipOccurrence(id, input.day);
    return NextResponse.json({ ok: true });
  }
  if (input.action === "restore") return (await restoreOccurrence(id, input.day)) ? NextResponse.json({ ok: true }) : notFound();
  return NextResponse.json({ event: await detachOccurrence(id, input.day, input.event) }, { status: 201 });
});
