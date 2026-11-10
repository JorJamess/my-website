import { COLOR_CLASSES } from "@/lib/colors";
import type { GoalOverview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PRIORITY_LABEL, PRIORITY_TEXT } from "./todo-list";

export const GOAL_STATUS_LABEL = { active: "Active", paused: "Paused", done: "Done", cancelled: "Cancelled" } as const;
export const HORIZON_LABEL = { short: "Short-term", long: "Long-term" } as const;

export function ProgressBar({ percent, className }: { percent: number | null; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)} role="img" aria-label={percent === null ? "No progress to measure yet" : `${Math.round(percent * 100)} percent`}>
      <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${Math.round((percent ?? 0) * 100)}%` }} />
    </div>
  );
}

export const pct = (p: number | null) => (p === null ? "–" : `${Math.round(p * 100)}%`);

export function daysLeftText(g: Pick<GoalOverview, "days_left" | "status" | "target_date">) {
  if (g.status === "done") return "Completed";
  if (g.days_left === null) return "No target date";
  if (g.days_left < 0) return `Overdue by ${-g.days_left} day${g.days_left === -1 ? "" : "s"}`;
  if (g.days_left === 0) return "Due today";
  return `${g.days_left} day${g.days_left === 1 ? "" : "s"} left`;
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("rounded-md bg-muted px-1.5 text-[12px]", className)}>{children}</span>;
}

export function GoalDot({ color, className }: { color: GoalOverview["color"]; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", COLOR_CLASSES[color].dot, className)} aria-hidden />;
}

export function PriorityText({ priority }: { priority: number }) {
  if (priority < 1) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium", PRIORITY_TEXT[priority])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** "3/5 milestones · 8/12 tasks": the raw counts behind the percentage */
export function progressCounts(g: Pick<GoalOverview, "progress">) {
  const { milestones: m, tasks: t } = g.progress;
  const parts: string[] = [];
  if (m.total) parts.push(`${m.done}/${m.total} milestones`);
  if (t.total) parts.push(`${t.done}/${t.total} tasks`);
  return parts.length ? parts.join(" · ") : "Add milestones or link tasks to track progress";
}
