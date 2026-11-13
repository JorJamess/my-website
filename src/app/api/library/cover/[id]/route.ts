import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { DriveError, fetchThumb, findCover, getConnection, isValidId } from "@/lib/server/google-drive";

type Ctx = { params: Promise<{ id: string }> };

/** Preview of the newest photo/video in a folder (404 when the folder has none). */
export const GET = api<Ctx>(async (req, { params }) => {
  const conn = await getConnection();
  if (!conn?.folderId) throw new DriveError("not_connected", 409);
  const id = (await params).id;
  if (!isValidId(id)) throw new DriveError("bad_request", 400);
  const cover = await findCover(id, conn.folderId);
  if (!cover) return NextResponse.json({ error: "no_cover" }, { status: 404 });
  const size = Math.min(800, Math.max(64, Number(new URL(req.url).searchParams.get("s")) || 320));
  const img = await fetchThumb(cover, conn.folderId, size);
  return new Response(img.body, { headers: { "Content-Type": img.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
});
