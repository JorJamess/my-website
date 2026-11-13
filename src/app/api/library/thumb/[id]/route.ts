import { api } from "@/lib/server/http";
import { DriveError, fetchThumb, getConnection, isValidId } from "@/lib/server/google-drive";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (req, { params }) => {
  const conn = await getConnection();
  if (!conn?.folderId) throw new DriveError("not_connected", 409);
  const id = (await params).id;
  if (!isValidId(id)) throw new DriveError("bad_request", 400);
  const size = Math.min(1600, Math.max(64, Number(new URL(req.url).searchParams.get("s")) || 400));
  const img = await fetchThumb(id, conn.folderId, size);
  return new Response(img.body, { headers: { "Content-Type": img.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": "private, max-age=3600" } });
});
