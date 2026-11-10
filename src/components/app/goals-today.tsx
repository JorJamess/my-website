"use client";

import Link from "next/link";
import type { GoalBrief } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GoalDot, pct, ProgressBar } from "./goal-bits";

/** The few active goals on the Today page. */
export function GoalsToday({ goals }: { goals: GoalBrief[] }) {
  return (
    <div>
      <h2 className="mb-3.5 flex items-center text-[13px] font-medium text-muted-foreground">
        Goals
        <Link href="/app/goals" className="ml-auto font-normal hover:text-brand">
          See all
        </Link>
      </h2>
      <ul>
        {goals.map((g) => (
          <li key={g.id} className="border-t">
            <Link href={`/app/goals/${g.id}`} className="block py-2.5 transition-colors hover:bg-muted/40">
              <span className="flex items-center gap-2 text-[15px]">
                <GoalDot color={g.color} />
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{pct(g.percent)}</span>
              </span>
              <ProgressBar percent={g.percent} className="mt-2" />
              <span className={cn("mt-1 block text-[12px] text-muted-foreground tabular-nums", g.overdue && "text-destructive")}>
                {g.days_left === null ? "No target date" : g.days_left < 0 ? `Overdue by ${-g.days_left} days` : g.days_left === 0 ? "Due today" : `${g.days_left} day${g.days_left === 1 ? "" : "s"} left`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
