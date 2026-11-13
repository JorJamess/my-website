import { api } from "@/lib/server/http";
import { DriveError, fetchContent, getConnection, isValidId } from "@/lib/server/google-drive";

type Ctx = { params: Promise<{ id: string }> };

/** Streams the original file (with Range so video seeking works). Only files inside the library folder. */
export const GET = api<Ctx>(async (req, { params }) => {
  const conn = await getConnection();
  if (!conn?.folderId) throw new DriveError("not_connected", 409);
  const id = (await params).id;
  if (!isValidId(id)) throw new DriveError("bad_request", 400);
  const res = await fetchContent(id, conn.folderId, req.headers.get("range"));
  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = res.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("Cache-Control", "private, max-age=3600");
  h.set("X-Content-Type-Options", "nosniff");
  const u = new URL(req.url);
  if (u.searchParams.get("download")) {
    // sanitized: the name only ever goes into this one header
    const name = (u.searchParams.get("n") ?? "file").replace(/[\x00-\x1f\x7f"\\/]/g, "_").slice(0, 150) || "file";
    h.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  } else h.set("Content-Disposition", "inline");
  return new Response(res.body, { status: res.status, headers: h });
});
