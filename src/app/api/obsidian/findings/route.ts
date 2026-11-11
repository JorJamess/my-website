import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listFindings } from "@/modules/obsidian/documents";

export const GET = api(async () => NextResponse.json({ findings: await listFindings() }));
