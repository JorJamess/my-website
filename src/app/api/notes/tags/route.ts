import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listTags } from "@/lib/server/repo";

export const GET = api(async () => NextResponse.json({ tags: await listTags() }));
