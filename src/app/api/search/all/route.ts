import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { SEARCH_TYPES, searchAll, type SearchType } from "@/lib/server/repo";

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  const types = (p.get("types") ?? "").split(",").filter((t): t is SearchType => (SEARCH_TYPES as readonly string[]).includes(t));
  const status = p.get("status");
  return NextResponse.json(
    await searchAll({
      q: p.get("q") ?? "",
      types: types.length ? types : undefined,
      from: day(p.get("from")),
      to: day(p.get("to")),
      status: status === "open" || status === "done" ? status : undefined,
      folder: p.get("folder") || undefined,
      tag: p.get("tag") || undefined,
    }),
  );
});
