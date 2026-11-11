import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getObsidianStatus } from "@/modules/obsidian/documents";

export const GET = api(async () => NextResponse.json(await getObsidianStatus()));
