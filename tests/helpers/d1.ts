import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A tiny in-memory stand-in for Cloudflare D1 (same prepare/bind/all/first/run/batch surface),
 * backed by Node's built-in SQLite. It applies the real files in /migrations, so the tests
 * run against the real schema.
 */
type Row = Record<string, unknown>;

class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private args: unknown[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.db, this.sql, args);
  }
  private get isRead() {
    return /^\s*(select|with|pragma)\b/i.test(this.sql);
  }
  async all<T = Row>() {
    const results = this.db.prepare(this.sql).all(...(this.args as never[])) as unknown as T[];
    return { results: results.map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
  }
  async first<T = Row>() {
    const row = this.db.prepare(this.sql).get(...(this.args as never[])) as T | undefined;
    return row ? ({ ...row } as T) : null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  async exec() {
    return this.isRead ? this.all() : this.run();
  }
}

export function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(dir, f), "utf8"));
  }
  return {
    prepare: (sql: string) => new Stmt(sqlite, sql),
    // D1 batches are atomic: roll everything back if one statement fails
    batch: async (stmts: Stmt[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.exec());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql: string) => sqlite.exec(sql),
  } as unknown as D1Database;
}
