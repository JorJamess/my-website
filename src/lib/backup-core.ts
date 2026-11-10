// ใช้ได้ทั้งใน Next (API routes) และใน custom-worker.ts (cron) — ห้าม import อะไรที่ผูกกับ Next

/**
 * Tables that are backed up and restored, in dependency order (parents first).
 * To include a new table in backups and restores, add it here; nothing else needs to change.
 */
export const BACKUP_TABLES = ["events", "notes", "categories", "todos", "habits", "habit_checkins"] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export const BACKUP_PREFIX = "backup:";
/** เก็บ snapshot ไว้ 8 สัปดาห์ แล้ว KV ลบให้เอง */
export const BACKUP_TTL_SECONDS = 8 * 7 * 24 * 60 * 60;

type Row = Record<string, unknown>;
export type BackupReason = "weekly" | "manual" | "pre-restore";

export type BackupSnapshot = {
  app: "jameswebpupu";
  version: 1;
  created_at: string;
  reason: BackupReason;
  tables: Partial<Record<BackupTable, Row[]>>;
};

export type BackupMeta = {
  created_at: string;
  reason: string;
  /** rows per table (older backups only have events and notes) */
  counts?: Partial<Record<BackupTable, number>>;
  events?: number;
  notes?: number;
  bytes: number;
};

export async function buildSnapshot(db: D1Database, reason: BackupReason): Promise<BackupSnapshot> {
  const results = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const tables = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t, results[i].results as Row[]])) as BackupSnapshot["tables"];
  return { app: "jameswebpupu", version: 1, created_at: new Date().toISOString(), reason, tables };
}

export function countRows(snap: BackupSnapshot): Partial<Record<BackupTable, number>> {
  return Object.fromEntries(BACKUP_TABLES.filter((t) => snap.tables[t]).map((t) => [t, snap.tables[t]!.length]));
}

export async function saveSnapshot(db: D1Database, kv: KVNamespace, reason: BackupReason) {
  const snap = await buildSnapshot(db, reason);
  const body = JSON.stringify(snap);
  const key = `${BACKUP_PREFIX}${snap.created_at}`;
  const counts = countRows(snap);
  const metadata: BackupMeta = {
    created_at: snap.created_at,
    reason,
    counts,
    events: counts.events ?? 0,
    notes: counts.notes ?? 0,
    bytes: body.length,
  };
  await kv.put(key, body, { expirationTtl: BACKUP_TTL_SECONDS, metadata });
  return { key, ...metadata };
}

export async function listSnapshots(kv: KVNamespace) {
  const { keys } = await kv.list<BackupMeta>({ prefix: BACKUP_PREFIX });
  return keys
    .map((k) => ({ key: k.name, ...(k.metadata ?? { created_at: k.name.slice(BACKUP_PREFIX.length), reason: "?", bytes: 0 }) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* ------------------------------- Restore ------------------------------- */

export class RestoreError extends Error {}

/** Check that parsed JSON is a backup we wrote. Returns it typed, or throws RestoreError. */
export function parseSnapshot(raw: unknown): BackupSnapshot {
  const s = raw as Partial<BackupSnapshot> | null;
  if (!s || typeof s !== "object" || s.app !== "jameswebpupu" || s.version !== 1 || typeof s.tables !== "object" || !s.tables) {
    throw new RestoreError("This isn't a jameswebpupu backup file");
  }
  for (const [name, rows] of Object.entries(s.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name)) throw new RestoreError(`Unknown table in backup: ${name}`);
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
      throw new RestoreError(`Table ${name} in the backup is malformed`);
    }
  }
  return s as BackupSnapshot;
}

async function columnsOf(db: D1Database, table: string) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return results.map((r) => r.name);
}

/** What a restore would change, without changing anything. */
export async function previewRestore(db: D1Database, snap: BackupSnapshot) {
  const out: { table: BackupTable; current: number; incoming: number }[] = [];
  for (const t of BACKUP_TABLES) {
    if (!snap.tables[t]) continue;
    const cur = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    out.push({ table: t, current: cur?.n ?? 0, incoming: snap.tables[t]!.length });
  }
  return out;
}

const CHUNK_CHARS = 40_000; // keep each statement's bound JSON well under D1's size limits

/**
 * Replace the contents of every table present in the backup, in one atomic D1 batch.
 * Tables the backup doesn't contain are left alone. Column names are checked against the live schema.
 * Older backups missing newer columns restore fine (those columns get their defaults).
 */
export async function restoreSnapshot(db: D1Database, snap: BackupSnapshot) {
  const present = BACKUP_TABLES.filter((t) => snap.tables[t]);
  if (!present.length) throw new RestoreError("The backup has no data to restore");

  const inserts: D1PreparedStatement[] = [];
  for (const t of present) {
    const live = new Set(await columnsOf(db, t));
    const rows = snap.tables[t]!;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const unknown = cols.filter((c) => !live.has(c));
    if (unknown.length) throw new RestoreError(`The backup has columns this version doesn't know (${t}: ${unknown.join(", ")})`);
    if (!rows.length) continue;
    const sql = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${cols
      .map((c) => `json_extract(value, '$."${c}"')`)
      .join(", ")} FROM json_each(?1)`;
    let chunk: Row[] = [];
    let size = 0;
    for (const row of rows) {
      const len = JSON.stringify(row).length;
      if (chunk.length && size + len > CHUNK_CHARS) {
        inserts.push(db.prepare(sql).bind(JSON.stringify(chunk)));
        chunk = [];
        size = 0;
      }
      chunk.push(row);
      size += len;
    }
    if (chunk.length) inserts.push(db.prepare(sql).bind(JSON.stringify(chunk)));
  }

  // children first when deleting, parents first when inserting
  const deletes = [...present].reverse().map((t) => db.prepare(`DELETE FROM ${t}`));
  await db.batch([...deletes, ...inserts]);
  return countRows(snap);
}
