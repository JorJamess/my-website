import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getSummary } from "@/lib/server/repo";

export const GET = api(async () => NextResponse.json(await getSummary(7)));
