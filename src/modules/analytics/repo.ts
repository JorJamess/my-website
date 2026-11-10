import "server-only";
import type { EventColor } from "@/lib/types";
import { habitPeriodStats, periodFor, rate, type AnalyticsRange, type Period } from "@/lib/analytics";
import { addDaysKey, localDateKey, parseLocal } from "@/lib/time";
import { ctx } from "../core";
import { getHabitsOverview } from "../habits/repo";
import { listGoals } from "../goals/repo";

export type Analytics = {
  range: AnalyticsRange;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  isCurrent: boolean;
  today: string;
  tasks: {
    completed: number;
    prevCompleted: number;
    created: number;
    /** tasks whose due date falls in the period: how many exist and how many are done */
    due: { total: number; done: number; rate: number | null };
    prevDue: { total: number; done: number; rate: number | null };
    /** right now, not just this period */
    open: number;
    overdue: number;
  };
  habits: {
    checkins: number;
    prevCheckins: number;
    done: number;
    scheduled: number;
    rate: number | null;
    prevRate: number | null;
    list: {
      id: string;
      title: string;
      color: EventColor;
      done: number;
      scheduled: number;
      rate: number | null;
      current_streak: number;
      longest_streak: number;
    }[];
  };
  goals: {
    active: number;
    completed: number;
    milestonesDone: number;
    prevMilestonesDone: number;
    progress: { id: string; title: string; color: EventColor; percent: number | null; days_left: number | null; overdue: boolean }[];
  };
  /** one entry per day of the period */
  days: { day: string; tasks: number; habits: number; milestones: number }[];
};

const dueStats = (rows: { done: number }[]) => {
  const done = rows.filter((r) => r.done).length;
  return { total: rows.length, done, rate: rate(done, rows.length) };
};

/**
 * Plain, measurable numbers for one week or month, with the previous period beside it.
 * There is no combined "productivity score": every figure is a count or a done/total ratio.
 */
export async function getAnalytics(opts: { range?: AnalyticsRange; offset?: number; today?: string } = {}): Promise<Analytics> {
  const { db, tz } = await ctx();
  const today = opts.today ?? localDateKey(new Date(), tz);
  const p: Period = periodFor(opts.range ?? "week", Math.min(0, Math.max(-60, opts.offset ?? 0)), today);
  const fromISO = parseLocal(p.prevStart, tz).toISOString(); // previous period start, for comparisons
  const startISO = parseLocal(p.start, tz).toISOString();
  const endISO = parseLocal(addDaysKey(p.end, 1), tz).toISOString();

  const [doneRows, createdRow, dueRows, prevDueRows, openRow, overdueRow, checkinRows, msRows, goalDoneRow, habits, goals] = await Promise.all([
    db.prepare("SELECT done_at FROM todos WHERE parent_id IS NULL AND done = 1 AND done_at >= ?1 AND done_at < ?2").bind(fromISO, endISO).all<{ done_at: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM todos WHERE parent_id IS NULL AND created_at >= ?1 AND created_at < ?2").bind(startISO, endISO).first<{ n: number }>(),
    db.prepare("SELECT done FROM todos WHERE parent_id IS NULL AND due_date >= ?1 AND due_date <= ?2").bind(p.start, p.end).all<{ done: number }>(),
    db.prepare("SELECT done FROM todos WHERE parent_id IS NULL AND due_date >= ?1 AND due_date <= ?2").bind(p.prevStart, p.prevEnd).all<{ done: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM todos WHERE parent_id IS NULL AND done = 0").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM todos WHERE parent_id IS NULL AND done = 0 AND due_date < ?1").bind(today).first<{ n: number }>(),
    db.prepare("SELECT habit_id, day FROM habit_checkins WHERE day >= ?1 AND day <= ?2").bind(p.prevStart, p.end).all<{ habit_id: string; day: string }>(),
    db.prepare("SELECT done_at FROM milestones WHERE done_at >= ?1 AND done_at < ?2").bind(fromISO, endISO).all<{ done_at: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM goals WHERE completed_at >= ?1 AND completed_at < ?2").bind(startISO, endISO).first<{ n: number }>(),
    getHabitsOverview(),
    listGoals({ includeInactive: true }),
  ]);

  const inPeriod = (day: string) => day >= p.start && day <= p.end;
  const inPrev = (day: string) => day >= p.prevStart && day <= p.prevEnd;
  const dayOf = (iso: string) => localDateKey(new Date(iso), tz);

  const perDay = new Map(p.days.map((d) => [d, { day: d, tasks: 0, habits: 0, milestones: 0 }]));
  let completed = 0;
  let prevCompleted = 0;
  for (const r of doneRows.results) {
    const d = dayOf(r.done_at);
    if (inPeriod(d)) {
      completed++;
      perDay.get(d)!.tasks++;
    } else if (inPrev(d)) prevCompleted++;
  }
  let msDone = 0;
  let prevMsDone = 0;
  for (const r of msRows.results) {
    const d = dayOf(r.done_at);
    if (inPeriod(d)) {
      msDone++;
      perDay.get(d)!.milestones++;
    } else if (inPrev(d)) prevMsDone++;
  }

  const byHabit = new Map<string, Set<string>>();
  let checkins = 0;
  let prevCheckins = 0;
  for (const r of checkinRows.results) {
    if (!byHabit.has(r.habit_id)) byHabit.set(r.habit_id, new Set());
    byHabit.get(r.habit_id)!.add(r.day);
    if (inPeriod(r.day)) {
      checkins++;
      perDay.get(r.day)!.habits++;
    } else if (inPrev(r.day)) prevCheckins++;
  }

  let doneSum = 0;
  let schedSum = 0;
  let prevDoneSum = 0;
  let prevSchedSum = 0;
  const list = habits.map((h) => {
    const done = byHabit.get(h.id) ?? new Set<string>();
    const cur = habitPeriodStats(h, done, p.start, p.end, today);
    const prev = habitPeriodStats(h, done, p.prevStart, p.prevEnd, today);
    doneSum += cur.done;
    schedSum += cur.scheduled;
    prevDoneSum += prev.done;
    prevSchedSum += prev.scheduled;
    return {
      id: h.id,
      title: h.title,
      color: h.color,
      done: cur.done,
      scheduled: cur.scheduled,
      rate: rate(cur.done, cur.scheduled),
      current_streak: h.stats.current_streak,
      longest_streak: h.stats.longest_streak,
    };
  });

  const activeGoals = goals.filter((g) => g.status === "active");
  return {
    range: p.range,
    start: p.start,
    end: p.end,
    prevStart: p.prevStart,
    prevEnd: p.prevEnd,
    isCurrent: p.isCurrent,
    today,
    tasks: {
      completed,
      prevCompleted,
      created: createdRow?.n ?? 0,
      due: dueStats(dueRows.results),
      prevDue: dueStats(prevDueRows.results),
      open: openRow?.n ?? 0,
      overdue: overdueRow?.n ?? 0,
    },
    habits: { checkins, prevCheckins, done: doneSum, scheduled: schedSum, rate: rate(doneSum, schedSum), prevRate: rate(prevDoneSum, prevSchedSum), list },
    goals: {
      active: activeGoals.length,
      completed: goalDoneRow?.n ?? 0,
      milestonesDone: msDone,
      prevMilestonesDone: prevMsDone,
      progress: activeGoals.map((g) => ({ id: g.id, title: g.title, color: g.color, percent: g.progress.percent, days_left: g.days_left, overdue: g.overdue })),
    },
    days: p.days.map((d) => perDay.get(d)!),
  };
}
