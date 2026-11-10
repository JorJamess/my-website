import "server-only";
import type { Category, EventColor, Todo, TodoStatus } from "@/lib/types";
import { TODO_PRIORITIES } from "@/lib/types";
import type { CategoryInput, TodoCreateInput, TodoUpdateInput } from "@/lib/schemas";
import { ctx, InputError } from "../core";

export type TodoRow = {
  id: string;
  title: string;
  note: string | null;
  due_date: string | null;
  important: number;
  priority: number;
  status: string;
  done: number;
  done_at: string | null;
  category_id: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  cat_name?: string | null;
  cat_color?: string | null;
};

export const toTodo = (r: TodoRow): Todo => ({
  id: r.id,
  title: r.title,
  note: r.note,
  due_date: r.due_date,
  priority: r.priority,
  status: (r.status as TodoStatus) ?? "todo",
  category: r.category_id && r.cat_name ? { id: r.category_id, name: r.cat_name, color: (r.cat_color ?? "gray") as EventColor } : null,
  parent_id: r.parent_id,
  important: r.priority >= 3,
  done: !!r.done,
  done_at: r.done_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const priorityNumber = (name: string | undefined, fallback: number) => {
  if (name === undefined) return fallback;
  const i = (TODO_PRIORITIES as readonly string[]).indexOf(name);
  return i < 0 ? fallback : i;
};

const SELECT = `SELECT t.*, c.name AS cat_name, c.color AS cat_color FROM todos t LEFT JOIN categories c ON c.id = t.category_id`;
const ORDER = `ORDER BY t.done ASC, t.priority DESC, t.due_date IS NULL, t.due_date ASC, COALESCE(t.done_at, t.created_at) DESC`;

/* --------------------------- Categories --------------------------- */

export async function listCategories(kind = "task"): Promise<Category[]> {
  const { db } = await ctx();
  const { results } = await db.prepare("SELECT id, name, color, kind FROM categories WHERE kind = ? ORDER BY name COLLATE NOCASE").bind(kind).all<Category>();
  return results;
}

/** Find a task category by name (case-insensitive), creating it when missing. */
export async function categoryIdFor(name: string, kind = "task"): Promise<string> {
  const { db } = await ctx();
  const clean = name.trim();
  if (!clean) throw new InputError("Category name can't be empty");
  const found = await db.prepare("SELECT id FROM categories WHERE kind = ?1 AND name = ?2 COLLATE NOCASE").bind(kind, clean).first<{ id: string }>();
  if (found) return found.id;
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO categories (id, name, color, kind, created_at) VALUES (?, ?, 'gray', ?, ?)")
    .bind(id, clean, kind, new Date().toISOString())
    .run();
  return id;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const { db } = await ctx();
  const id = await categoryIdFor(input.name);
  if (input.color) await db.prepare("UPDATE categories SET color = ? WHERE id = ?").bind(input.color, id).run();
  return (await db.prepare("SELECT id, name, color, kind FROM categories WHERE id = ?").bind(id).first<Category>())!;
}

export async function updateCategory(id: string, input: Partial<CategoryInput>): Promise<Category | null> {
  const { db } = await ctx();
  const cur = await db.prepare("SELECT id, name, color, kind FROM categories WHERE id = ?").bind(id).first<Category>();
  if (!cur) return null;
  const name = input.name?.trim() || cur.name;
  const clash = await db.prepare("SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE AND id <> ?").bind(cur.kind, name, id).first();
  if (clash) throw new InputError(`There is already a category called "${name}"`);
  await db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ?").bind(name, input.color ?? cur.color, id).run();
  return (await db.prepare("SELECT id, name, color, kind FROM categories WHERE id = ?").bind(id).first<Category>())!;
}

/** Removes the category; tasks keep existing, just without a category. */
export async function deleteCategory(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("UPDATE todos SET category_id = NULL WHERE category_id = ?").bind(id).run();
  await db.prepare("UPDATE goals SET category_id = NULL WHERE category_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ----------------------------- To-dos ----------------------------- */

export async function listTodosByIds(ids: string[]): Promise<Todo[]> {
  if (!ids.length) return [];
  const { db } = await ctx();
  const { results } = await db
    .prepare(`${SELECT} WHERE t.id IN (${ids.map((_, i) => `?${i + 1}`).join(",")}) ${ORDER}`)
    .bind(...ids)
    .all<TodoRow>();
  return results.map(toTodo);
}

export async function listTodos(
  opts: { includeDone?: boolean; q?: string; limit?: number; status?: TodoStatus; category?: string; minPriority?: number; parentId?: string | null } = {},
): Promise<Todo[]> {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  const bind = (v: unknown) => `?${binds.push(v)}`;
  if (!opts.includeDone && !opts.status) where.push("t.done = 0");
  if (opts.status) where.push(`t.status = ${bind(opts.status)}`);
  if (opts.q) where.push(`(t.title LIKE ${bind(`%${opts.q}%`)} OR t.note LIKE ?${binds.length})`);
  if (opts.category) where.push(`c.name = ${bind(opts.category)} COLLATE NOCASE`);
  if (opts.minPriority) where.push(`t.priority >= ${bind(opts.minPriority)}`);
  if (opts.parentId === null) where.push("t.parent_id IS NULL");
  else if (opts.parentId) where.push(`t.parent_id = ${bind(opts.parentId)}`);
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 600);
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ${ORDER} LIMIT ${limit}`;
  const { results } = await db.prepare(sql).bind(...binds).all<TodoRow>();
  return results.map(toTodo);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const { db } = await ctx();
  const row = await db.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first<TodoRow>();
  return row ? toTodo(row) : null;
}

export async function createTodo(input: TodoCreateInput): Promise<Todo> {
  const { db } = await ctx();
  if (input.parent_id) {
    const parent = await getTodo(input.parent_id);
    if (!parent) throw new InputError(`No task with id ${input.parent_id}`);
    if (parent.parent_id) throw new InputError("Subtasks can't have their own subtasks");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const priority = input.priority !== undefined ? priorityNumber(input.priority, 0) : input.important ? 3 : 0;
  const status: TodoStatus = input.status ?? "todo";
  const categoryId = input.category ? await categoryIdFor(input.category) : null;
  await db
    .prepare(
      `INSERT INTO todos (id, title, note, due_date, important, priority, status, category_id, parent_id, done, done_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title.trim(),
      input.note?.trim() || null,
      input.due_date ?? null,
      priority >= 3 ? 1 : 0,
      priority,
      status,
      categoryId,
      input.parent_id ?? null,
      status === "done" ? 1 : 0,
      status === "done" ? now : null,
      now,
      now,
    )
    .run();
  return (await getTodo(id))!;
}

export async function updateTodo(id: string, input: TodoUpdateInput): Promise<Todo | null> {
  const { db } = await ctx();
  const cur = await getTodo(id);
  if (!cur) return null;
  const now = new Date().toISOString();

  // status and done are one fact: done <=> status "done"
  let status: TodoStatus = cur.status;
  if (input.status !== undefined) status = input.status;
  else if (input.done !== undefined) status = input.done ? "done" : cur.status === "done" ? "todo" : cur.status;
  const done = status === "done";

  const priority =
    input.priority !== undefined ? priorityNumber(input.priority, cur.priority) : input.important !== undefined ? (input.important ? 3 : 0) : cur.priority;
  const categoryId =
    input.category === undefined ? (cur.category?.id ?? null) : input.category === null ? null : await categoryIdFor(input.category);

  await db
    .prepare(
      `UPDATE todos SET title=?, note=?, due_date=?, important=?, priority=?, status=?, category_id=?, done=?, done_at=?, updated_at=? WHERE id=?`,
    )
    .bind(
      input.title?.trim() ?? cur.title,
      input.note === undefined ? cur.note : input.note?.trim() || null,
      input.due_date === undefined ? cur.due_date : input.due_date,
      priority >= 3 ? 1 : 0,
      priority,
      status,
      categoryId,
      done ? 1 : 0,
      done ? (cur.done ? cur.done_at : now) : null,
      now,
      id,
    )
    .run();
  return getTodo(id);
}

/** Deletes the task and its subtasks. */
export async function deleteTodo(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("DELETE FROM goal_links WHERE entity_type = 'task' AND entity_id IN (SELECT id FROM todos WHERE parent_id = ?1 OR id = ?1)").bind(id).run();
  await db.prepare("DELETE FROM todos WHERE parent_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}
