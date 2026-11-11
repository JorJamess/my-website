import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { exceptFinding } from "@/modules/obsidian/documents";

type Ctx = { params: Promise<{ id: string }> };

/** Approve one finding (valid only for the exact content it was found in). */
export const POST = api<Ctx>(async (_req, { params }) => ((await exceptFinding((await params).id)) ? NextResponse.json({ ok: true }) : notFound()));
