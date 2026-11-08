import { api, notFound } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";
import { BACKUP_PREFIX, buildSnapshot } from "@/lib/backup-core";

/** ดาวน์โหลด backup: ?key=backup:... สำหรับที่เก็บไว้ หรือไม่ส่ง key = ข้อมูลล่าสุดตอนนี้ */
export const GET = api(async (req) => {
  const env = await getEnv();
  const key = new URL(req.url).searchParams.get("key");
  let body: string;
  let stamp: string;
  if (key) {
    if (!key.startsWith(BACKUP_PREFIX)) return notFound();
    const stored = await env.BACKUPS.get(key);
    if (!stored) return notFound();
    body = stored;
    stamp = key.slice(BACKUP_PREFIX.length);
  } else {
    const snap = await buildSnapshot(env.DB, "manual");
    body = JSON.stringify(snap, null, 2);
    stamp = snap.created_at;
  }
  const name = `jameswebpupu-backup-${stamp.slice(0, 16).replace(/[:T]/g, "-")}.json`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
