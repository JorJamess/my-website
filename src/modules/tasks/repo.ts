import "server-only";
import type { Todo } from "@/lib/types";
import type { TodoCreateInput, TodoUpdateInput } from "@/lib/schemas";
import { ctx } from "../core";

export type TodoRow = Omit<Todo, "important" | "done"> & { important: number; done: number };
export const toTodo = (r: TodoRow): Todo => ({ ...r, important: !!r.important, done: !!r.done });

/* ----------------------------- To-dos ----------------------------- */

export async function listTodos(opts: { includeDone?: boolean; q?: string; limit?: number } = {}): Promise<Todo[]> {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (!opts.includeDone) where.push("done = 0");
  if (opts.q) {
    where.push(`(title LIKE ?${binds.length + 1} OR note LIKE ?${binds.length + 1})`);
    binds.push(`%${opts.q}%`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const sql = `SELECT * FROM todos ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY done ASC, important DESC, due_date IS NULL, due_date ASC, COALESCE(done_at, created_at) DESC LIMIT ${limit}`;
  const { results } = await db.prepare(sql).bind(...binds).all<TodoRow>();
  return results.map(toTodo);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first<TodoRow>();
  return row ? toTodo(row) : null;
}

export async function createTodo(input: TodoCreateInput): Promise<Todo> {
  const { db } = await ctx();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO todos (id, title, note, due_date, important, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(id, input.title.trim(), input.note?.trim() || null, input.due_date ?? null, input.important ? 1 : 0, now, now)
    .run();
  return (await getTodo(id))!;
}

export async function updateTodo(id: string, input: TodoUpdateInput): Promise<Todo | null> {
  const { db } = await ctx();
  const cur = await getTodo(id);
  if (!cur) return null;
  const done = input.done ?? cur.done;
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE todos SET title=?, note=?, due_date=?, important=?, done=?, done_at=?, updated_at=? WHERE id=?`,
    )
    .bind(
      input.title?.trim() ?? cur.title,
      input.note === undefined ? cur.note : input.note?.trim() || null,
      input.due_date === undefined ? cur.due_date : input.due_date,
      (input.important ?? cur.important) ? 1 : 0,
      done ? 1 : 0,
      done ? (cur.done ? cur.done_at : now) : null,
      now,
      id,
    )
    .run();
  return getTodo(id);
}

export async function deleteTodo(id: string): Promise<boolean> {
  const { db } = await ctx();
  const r = await db.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

