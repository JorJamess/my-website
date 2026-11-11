import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { createPairingCode } from "@/modules/obsidian/devices";

/** Owner starts pairing: returns a one-time code valid for 10 minutes. */
export const POST = api(async () => NextResponse.json(await createPairingCode()));
