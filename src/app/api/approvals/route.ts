import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listAudit, listPending } from "@/lib/server/repo";

export const GET = api(async () => NextResponse.json({ pending: await listPending(), audit: await listAudit(40) }));
