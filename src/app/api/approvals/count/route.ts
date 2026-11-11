import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { countPending } from "@/lib/server/repo";

export const GET = api(async () => NextResponse.json({ count: await countPending() }));
