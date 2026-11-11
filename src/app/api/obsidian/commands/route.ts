import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { listCommands } from "@/modules/obsidian/commands";

export const GET = api(async () => NextResponse.json({ commands: await listCommands() }));
