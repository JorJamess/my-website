import "server-only";
import type { EventColor, Goal, GoalBrief, GoalDetail, GoalLinkType, GoalOverview, GoalProgress, GoalStatus, Milestone } from "@/lib/types";
import { TODO_PRIORITIES } from "@/lib/types";
import type { GoalCreateInput, GoalLinkInput, GoalUpdateInput, MilestoneCreateInput, MilestoneUpdateInput } from "@/lib/schemas";
import { daysBetween } from "@/lib/habits";
import { isValidDate, localDateKey, parseLocal } from "@/lib/time";
import { ctx, InputError } from "../core";
import { getEvent } from "../events/repo";
import { getHabitsOverview } from "../habits/repo";
import { getNote } from "../notes/repo";
import { categoryIdFor, getTodo, listTodosByIds } from "../tasks/repo";

type GoalRow = {
  id: string;
  title: string;
  description: string | null;
  horizon: string;
  category_id: string | null;
  priority: number;
  status: string;
  color: string;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  cat_name?: string | null;
  cat_color?: string | null;
};

const toGoal = (r: GoalRow): Goal => ({
  id: r.id,
  title: r.title,
  description: r.description,
  horizon: r.horizon === "long" ? "long" : "short",
  category: r.category_id && r.cat_name ? { id: r.category_id, name: r.cat_name, color: (r.cat_color ?? "gray") as EventColor } : null,
  priority: r.priority,
  status: r.status as GoalStatus,
  color: r.color as EventColor,
  start_date: r.start_date,
  target_date: r.target_date,
  completed_at: r.completed_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const SELECT = `SELECT g.*, c.name AS cat_name, c.color AS cat_color FROM goals g LEFT JOIN categories c ON c.id = g.category_id`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const priorityNumber = (name: string | undefined, fallback: number) => {
  if (name === undefined) return fallback;
  const i = (TODO_PRIORITIES as readonly string[]).indexOf(name);
  return i < 0 ? fallback : i;
};

function assertDay(day: string | null | undefined, what: string) {
  if (day == null) return;
  if (!DAY.test(day) || !isValidDate(parseLocal(day))) throw new InputError(`Invalid ${what}: "${day}"`);
}

/** Progress from raw counts: no weights, no score, just done over total. */
export function computeProgress(m: { done: number; total: number }, t: { done: number; total: number }): GoalProgress {
  const total = m.total + t.total;
  return { milestones: m, tasks: t, percent: total ? (m.done + t.done) / total : null };
}

export function daysLeft(target: string | null, today: string): number | null {
  return target ? daysBetween(today, target) : null;
}

/* ------------------------------ Goals ------------------------------ */

async function overviews(goals: Goal[]): Promise<GoalOverview[]> {
  const { db, tz } = await ctx();
  const today = localDateKey(new Date(), tz);
  const [ms, ts, ls] = await Promise.all([
    db.prepare("SELECT goal_id, COUNT(*) AS total, SUM(CASE WHEN done_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM milestones GROUP BY goal_id").all<{ goal_id: string; total: number; done: number }>(),
    db
      .prepare(
        `SELECT gl.goal_id, COUNT(*) AS total, SUM(t.done) AS done FROM goal_links gl JOIN todos t ON t.id = gl.entity_id
         WHERE gl.entity_type = 'task' GROUP BY gl.goal_id`,
      )
      .all<{ goal_id: string; total: number; done: number }>(),
    db.prepare("SELECT goal_id, entity_type, COUNT(*) AS n FROM goal_links GROUP BY goal_id, entity_type").all<{ goal_id: string; entity_type: GoalLinkType; n: number }>(),
  ]);
  const mBy = new Map(ms.results.map((r) => [r.goal_id, r]));
  const tBy = new Map(ts.results.map((r) => [r.goal_id, r]));
  return goals.map((g) => {
    const counts = { task: 0, habit: 0, event: 0, note: 0 };
    for (const l of ls.results) if (l.goal_id === g.id) counts[l.entity_type] = l.n;
    const m = mBy.get(g.id);
    const t = tBy.get(g.id);
    const left = daysLeft(g.target_date, today);
    return {
      ...g,
      progress: computeProgress({ done: m?.done ?? 0, total: m?.total ?? 0 }, { done: t?.done ?? 0, total: t?.total ?? 0 }),
      days_left: left,
      overdue: g.status === "active" && left !== null && left < 0,
      link_counts: counts,
    };
  });
}

export async function listGoals(opts: { status?: GoalStatus; includeInactive?: boolean } = {}): Promise<GoalOverview[]> {
  const { db } = await ctx();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) {
    where.push("g.status = ?1");
    binds.push(opts.status);
  } else if (!opts.includeInactive) where.push("g.status IN ('active', 'paused')");
  const { results } = await db
    .prepare(
      `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, g.priority DESC, g.target_date IS NULL, g.target_date ASC, g.created_at DESC`,
    )
    .bind(...binds)
    .all<GoalRow>();
  return overviews(results.map(toGoal));
}

async function getGoalRow(id: string): Promise<Goal | null> {
  const { db } = await ctx();
  const row = await db.prepare(`${SELECT} WHERE g.id = ?`).bind(id).first<GoalRow>();
  return row ? toGoal(row) : null;
}

export async function getGoal(id: string): Promise<GoalOverview | null> {
  const g = await getGoalRow(id);
  return g ? (await overviews([g]))[0] : null;
}

export async function listMilestones(goalId: string): Promise<Milestone[]> {
  const { db } = await ctx();
  const { results } = await db
    .prepare("SELECT id, goal_id, title, due_date, done_at, sort_order FROM milestones WHERE goal_id = ? ORDER BY sort_order ASC, created_at ASC")
    .bind(goalId)
    .all<Milestone>();
  return results;
}

/** Everything about one goal: progress, milestones, and the linked tasks, habits, events and notes. */
export async function getGoalDetail(id: string): Promise<GoalDetail | null> {
  const { db } = await ctx();
  const overview = await getGoal(id);
  if (!overview) return null;
  const [milestones, linkRows] = await Promise.all([
    listMilestones(id),
    db.prepare("SELECT entity_type, entity_id FROM goal_links WHERE goal_id = ? ORDER BY created_at ASC").bind(id).all<{ entity_type: GoalLinkType; entity_id: string }>(),
  ]);
  const ids = (type: GoalLinkType) => linkRows.results.filter((l) => l.entity_type === type).map((l) => l.entity_id);
  const habitIds = new Set(ids("habit"));
  const [tasks, habits, events, notes] = await Promise.all([
    listTodosByIds(ids("task")),
    habitIds.size ? getHabitsOverview({ includeArchived: true }) : Promise.resolve([]),
    Promise.all(ids("event").map((e) => getEvent(e))),
    Promise.all(ids("note").map((n) => getNote(n))),
  ]);
  return {
    ...overview,
    milestones,
    links: {
      tasks,
      habits: habits
        .filter((h) => habitIds.has(h.id))
        .map((h) => ({ id: h.id, title: h.title, color: h.color, current_streak: h.stats.current_streak, rate_30d: h.stats.last30.rate, archived: !!h.archived_at })),
      events: events.filter((e): e is NonNullable<typeof e> => !!e).map((e) => ({ id: e.id, title: e.title, start_at: e.start_at, all_day: e.all_day, color: e.color })),
      notes: notes.filter((n): n is NonNullable<typeof n> => !!n).map((n) => ({ id: n.id, title: n.title })),
    },
  };
}

export async function createGoal(input: GoalCreateInput): Promise<GoalOverview> {
  const { db } = await ctx();
  assertDay(input.start_date, "start date");
  assertDay(input.target_date, "target date");
  if (input.start_date && input.target_date && input.target_date < input.start_date) throw new InputError("The target date can't be before the start date");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const status: GoalStatus = input.status ?? "active";
  const categoryId = input.category ? await categoryIdFor(input.category, "goal") : null;
  await db
    .prepare(
      `INSERT INTO goals (id, title, description, horizon, category_id, priority, status, color, start_date, target_date, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title.trim(),
      input.description?.trim() || null,
      input.horizon ?? "short",
      categoryId,
      priorityNumber(input.priority, 0),
      status,
      input.color ?? "blue",
      input.start_date ?? null,
      input.target_date ?? null,
      status === "done" ? now : null,
      now,
      now,
    )
    .run();
  return (await getGoal(id))!;
}

export async function updateGoal(id: string, input: GoalUpdateInput): Promise<GoalOverview | null> {
  const { db } = await ctx();
  const cur = await getGoalRow(id);
  if (!cur) return null;
  const start = input.start_date === undefined ? cur.start_date : input.start_date;
  const target = input.target_date === undefined ? cur.target_date : input.target_date;
  assertDay(start, "start date");
  assertDay(target, "target date");
  if (start && target && target < start) throw new InputError("The target date can't be before the start date");
  const status = input.status ?? cur.status;
  const now = new Date().toISOString();
  const completed = status === "done" ? (cur.status === "done" ? cur.completed_at : now) : null;
  const categoryId = input.category === undefined ? (cur.category?.id ?? null) : input.category === null ? null : await categoryIdFor(input.category, "goal");
  await db
    .prepare(
      `UPDATE goals SET title=?, description=?, horizon=?, category_id=?, priority=?, status=?, color=?, start_date=?, target_date=?, completed_at=?, updated_at=? WHERE id=?`,
    )
    .bind(
      input.title?.trim() ?? cur.title,
      input.description === undefined ? cur.description : input.description?.trim() || null,
      input.horizon ?? cur.horizon,
      categoryId,
      priorityNumber(input.priority, cur.priority),
      status,
      input.color ?? cur.color,
      start,
      target,
      completed,
      now,
      id,
    )
    .run();
  return getGoal(id);
}

/** Deletes the goal, its milestones and its links. The linked tasks, habits, events and notes stay. */
export async function deleteGoal(id: string): Promise<boolean> {
  const { db } = await ctx();
  await db.prepare("DELETE FROM milestones WHERE goal_id = ?").bind(id).run();
  await db.prepare("DELETE FROM goal_links WHERE goal_id = ?").bind(id).run();
  const r = await db.prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ---------------------------- Milestones ---------------------------- */

export async function addMilestone(goalId: string, input: MilestoneCreateInput): Promise<Milestone> {
  const { db } = await ctx();
  if (!(await getGoalRow(goalId))) throw new InputError(`No goal with id ${goalId}`);
  assertDay(input.due_date, "due date");
  const next = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM milestones WHERE goal_id = ?").bind(goalId).first<{ n: number }>();
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO milestones (id, goal_id, title, due_date, done_at, sort_order, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)")
    .bind(id, goalId, input.title.trim(), input.due_date ?? null, next?.n ?? 0, new Date().toISOString())
    .run();
  return (await db.prepare("SELECT id, goal_id, title, due_date, done_at, sort_order FROM milestones WHERE id = ?").bind(id).first<Milestone>())!;
}

export async function updateMilestone(id: string, input: MilestoneUpdateInput): Promise<Milestone | null> {
  const { db } = await ctx();
  const cur = await db.prepare("SELECT id, goal_id, title, due_date, done_at, sort_order FROM milestones WHERE id = ?").bind(id).first<Milestone>();
  if (!cur) return null;
  assertDay(input.due_date, "due date");
  const doneAt = input.done === undefined ? cur.done_at : input.done ? (cur.done_at ?? new Date().toISOString()) : null;
  await db
    .prepare("UPDATE milestones SET title = ?, due_date = ?, done_at = ? WHERE id = ?")
    .bind(input.title?.trim() ?? cur.title, input.due_date === undefined ? cur.due_date : input.due_date, doneAt, id)
    .run();
  return (await db.prepare("SELECT id, goal_id, title, due_date, done_at, sort_order FROM milestones WHERE id = ?").bind(id).first<Milestone>())!;
}

export async function deleteMilestone(id: string): Promise<boolean> {
  const { db } = await ctx();
  const r = await db.prepare("DELETE FROM milestones WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/* ------------------------------ Links ------------------------------ */

async function entityExists(type: GoalLinkType, id: string): Promise<boolean> {
  switch (type) {
    case "task":
      return !!(await getTodo(id));
    case "event":
      return !!(await getEvent(id));
    case "note":
      return !!(await getNote(id));
    case "habit": {
      const { db } = await ctx();
      return !!(await db.prepare("SELECT 1 AS x FROM habits WHERE id = ?").bind(id).first());
    }
  }
}

/** Link a task, habit, event or note to a goal. Linking twice is harmless. */
export async function linkToGoal(goalId: string, input: GoalLinkInput): Promise<void> {
  const { db } = await ctx();
  if (!(await getGoalRow(goalId))) throw new InputError(`No goal with id ${goalId}`);
  if (!(await entityExists(input.entity_type, input.entity_id))) throw new InputError(`No ${input.entity_type} with id ${input.entity_id}`);
  await db
    .prepare("INSERT OR IGNORE INTO goal_links (goal_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(goalId, input.entity_type, input.entity_id, new Date().toISOString())
    .run();
}

export async function unlinkFromGoal(goalId: string, input: GoalLinkInput): Promise<boolean> {
  const { db } = await ctx();
  const r = await db
    .prepare("DELETE FROM goal_links WHERE goal_id = ? AND entity_type = ? AND entity_id = ?")
    .bind(goalId, input.entity_type, input.entity_id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** The few active goals shown on the Today page. */
export async function getGoalsBrief(limit = 3): Promise<GoalBrief[]> {
  const active = await listGoals({ status: "active" });
  return active.slice(0, limit).map((g) => ({
    id: g.id,
    title: g.title,
    color: g.color,
    percent: g.progress.percent,
    days_left: g.days_left,
    target_date: g.target_date,
    overdue: g.overdue,
  }));
}
