import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { DriveError, folderInfo, getConnection, isValidId, listFolder } from "@/lib/server/google-drive";

/** Files and folders inside the library folder (or a sub-folder of it). */
export const GET = api(async (req) => {
  const conn = await getConnection();
  if (!conn) throw new DriveError("not_connected", 409);
  if (!conn.folderId) throw new DriveError("no_library_folder", 404);
  const u = new URL(req.url);
  const folder = u.searchParams.get("folder") || conn.folderId;
  const page = u.searchParams.get("page") || undefined;
  if (!isValidId(folder) || (page && page.length > 2000)) throw new DriveError("bad_request", 400);
  const [list, info] = await Promise.all([listFolder(folder, conn.folderId, page), folderInfo(folder, conn.folderId)]);
  return NextResponse.json({ ...list, folder: { id: info.id, name: info.name, isRoot: info.id === conn.folderId, parent: info.id === conn.folderId ? null : info.parents?.[0] ?? null } });
});
