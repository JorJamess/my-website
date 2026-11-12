import { NextResponse } from "next/server";
import { z } from "zod";
import { api, notFound } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";
import { BACKUP_PREFIX, parseSnapshot, previewRestore, RestoreError, restoreSnapshot, saveSnapshot } from "@/lib/backup-core";

const body = z.object({
  key: z.string().startsWith(BACKUP_PREFIX),
  /** false (default) only previews; true actually restores */
  confirm: z.boolean().optional(),
});

/**
 * Restore from a stored backup.
 * Without confirm=true this only returns what would change. With confirm=true a safety copy of the
 * current data is saved first, then the tables are replaced atomically.
 */
export const POST = api(async (req) => {
  const { key, confirm } = body.parse(await req.json());
  const env = await getEnv();
  const stored = await env.BACKUPS.get(key);
  if (!stored) return notFound();

  try {
    const snap = parseSnapshot(JSON.parse(stored));
    const preview = await previewRestore(env.DB, snap);
    if (!confirm) return NextResponse.json({ preview });
    const safety = await saveSnapshot(env.DB, env.BACKUPS, "pre-restore");
    const restored = await restoreSnapshot(env.DB, snap);
    return NextResponse.json({ ok: true, restored, safety_backup: safety.key });
  } catch (err) {
    if (err instanceof RestoreError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
});
