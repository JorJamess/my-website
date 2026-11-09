// ใช้ได้ทั้งใน Next (API routes) และใน custom-worker.ts (cron) — ห้าม import อะไรที่ผูกกับ Next
export const BACKUP_TABLES = ["events", "notes", "todos"] as const;
export const BACKUP_PREFIX = "backup:";
/** เก็บ snapshot ไว้ 8 สัปดาห์ แล้ว KV ลบให้เอง */
export const BACKUP_TTL_SECONDS = 8 * 7 * 24 * 60 * 60;

export type BackupSnapshot = {
  app: "jameswebpupu";
  version: 1;
  created_at: string;
  reason: "weekly" | "manual";
  tables: Record<(typeof BACKUP_TABLES)[number], Record<string, unknown>[]>;
};

export type BackupMeta = { created_at: string; reason: string; events: number; notes: number; bytes: number };

export async function buildSnapshot(db: D1Database, reason: BackupSnapshot["reason"]): Promise<BackupSnapshot> {
  const results = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const tables = Object.fromEntries(
    BACKUP_TABLES.map((t, i) => [t, results[i].results as Record<string, unknown>[]]),
  ) as BackupSnapshot["tables"];
  return { app: "jameswebpupu", version: 1, created_at: new Date().toISOString(), reason, tables };
}

export async function saveSnapshot(db: D1Database, kv: KVNamespace, reason: BackupSnapshot["reason"]) {
  const snap = await buildSnapshot(db, reason);
  const body = JSON.stringify(snap);
  const key = `${BACKUP_PREFIX}${snap.created_at}`;
  const metadata: BackupMeta = {
    created_at: snap.created_at,
    reason,
    events: snap.tables.events.length,
    notes: snap.tables.notes.length,
    bytes: body.length,
  };
  await kv.put(key, body, { expirationTtl: BACKUP_TTL_SECONDS, metadata });
  return { key, ...metadata };
}

export async function listSnapshots(kv: KVNamespace) {
  const { keys } = await kv.list<BackupMeta>({ prefix: BACKUP_PREFIX });
  return keys
    .map((k) => ({ key: k.name, ...(k.metadata ?? { created_at: k.name.slice(BACKUP_PREFIX.length), reason: "?", events: 0, notes: 0, bytes: 0 }) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
