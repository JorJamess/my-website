import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";
import { listSnapshots, saveSnapshot } from "@/lib/backup-core";

/** รายการ backup ที่เก็บไว้ */
export const GET = api(async () => {
  const env = await getEnv();
  return NextResponse.json({ backups: await listSnapshots(env.BACKUPS) });
});

/** สำรองตอนนี้เลย */
export const POST = api(async () => {
  const env = await getEnv();
  return NextResponse.json({ backup: await saveSnapshot(env.DB, env.BACKUPS, "manual") }, { status: 201 });
});
