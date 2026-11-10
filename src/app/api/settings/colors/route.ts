import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/lib/server/http";
import { getColorNames, setColorNames } from "@/lib/server/repo";
import { EVENT_COLORS } from "@/lib/types";

const body = z.object(Object.fromEntries(EVENT_COLORS.map((c) => [c, z.string().max(40).optional()])) as Record<(typeof EVENT_COLORS)[number], z.ZodOptional<z.ZodString>>);

export const GET = api(async () => NextResponse.json({ names: await getColorNames() }));

export const PUT = api(async (req) => NextResponse.json({ names: await setColorNames(body.parse(await req.json())) }));
