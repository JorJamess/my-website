import "server-only";
import type { EventColor } from "@/lib/types";
import { ctx, InputError } from "../core";

export type CalendarItems = {
  /** open and done tasks whose due date falls in the range */
  tasks: { id: string; title: string; due_date: string; done: boolean; priority: number }[];
  /** milestones of active or paused goals due in the range */
  milestones: { id: string; goal_id: string; goal_title: string; title: string; due_date: string; done: boolean; color: EventColor }[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What else belongs on the calendar between two dates (inclusive): tasks with a due date and goal milestones. */
export async function getCalendarItems(from: string, to: string): Promise<CalendarItems> {
  if (!DAY.test(from) || !DAY.test(to) || to < from) throw new InputError("from and to must be YYYY-MM-DD dates, from first");
  const { db } = await ctx();
  const [tasks, milestones] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, due_date, done, priority FROM todos
         WHERE parent_id IS NULL AND due_date >= ?1 AND due_date <= ?2 ORDER BY due_date ASC, priority DESC LIMIT 300`,
      )
      .bind(from, to)
      .all<{ id: string; title: string; due_date: string; done: number; priority: number }>(),
    db
      .prepare(
        `SELECT m.id, m.goal_id, g.title AS goal_title, m.title, m.due_date, m.done_at, g.color
         FROM milestones m JOIN goals g ON g.id = m.goal_id
         WHERE m.due_date >= ?1 AND m.due_date <= ?2 AND g.status IN ('active', 'paused') ORDER BY m.due_date ASC LIMIT 300`,
      )
      .bind(from, to)
      .all<{ id: string; goal_id: string; goal_title: string; title: string; due_date: string; done_at: string | null; color: string }>(),
  ]);
  return {
    tasks: tasks.results.map((t) => ({ ...t, done: !!t.done })),
    milestones: milestones.results.map((m) => ({
      id: m.id,
      goal_id: m.goal_id,
      goal_title: m.goal_title,
      title: m.title,
      due_date: m.due_date,
      done: !!m.done_at,
      color: m.color as EventColor,
    })),
  };
}
