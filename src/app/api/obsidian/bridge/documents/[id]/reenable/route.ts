import { NextResponse } from "next/server";
import { deviceApi } from "@/lib/server/device-api";
import { reenableDocument } from "@/modules/obsidian/documents";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The owner chose to re-enable a revoked note from the Mac (`obsidian-bridge reenable`), after reviewing it there.
 * Returns the new grant version; the Mac scans the note again and uploads with it.
 */
export const POST = deviceApi<Ctx>(async (_req, { params }) => NextResponse.json(await reenableDocument((await params).id)));
