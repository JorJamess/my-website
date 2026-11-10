"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatDay } from "@/lib/time";
import type { GoalOverview, GoalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, daysLeftText, GOAL_STATUS_LABEL, GoalDot, HORIZON_LABEL, PriorityText, pct, ProgressBar, progressCounts } from "./goal-bits";
import { GoalDialog } from "./goal-dialog";
import { Pupu } from "./pupu";

type View = "active" | "paused" | "done" | "all";
const VIEWS: { id: View; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

const linkedText = (g: GoalOverview) => {
  const c = g.link_counts;
  const parts = [c.habit && `${c.habit} habit${c.habit > 1 ? "s" : ""}`, c.event && `${c.event} event${c.event > 1 ? "s" : ""}`, c.note && `${c.note} note${c.note > 1 ? "s" : ""}`].filter(Boolean);
  return parts.join(" · ");
};

export function GoalsView() {
  const { data, loading, error } = useData(() => api.goals(true), []);
  const [view, setView] = useState<View>("active");
  const [dialog, setDialog] = useState(false);

  const goals = data?.goals ?? [];
  const count = (s: GoalStatus) => goals.filter((g) => g.status === s).length;
  const shown = goals.filter((g) => view === "all" || g.status === view || (view === "done" && g.status === "cancelled"));

  return (
    <div className="mx-auto max-w-[760px]">
      <header className="flex items-end gap-4 border-b pb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Goals</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Big things you&rsquo;re working toward. Link tasks, habits, events and notes to see progress.</p>
        </div>
        <Button className="ml-auto h-9 shrink-0 px-4" onClick={() => setDialog(true)}>
          <Plus /> New goal
        </Button>
      </header>

      <div className="flex rounded-lg bg-muted p-0.5 mt-5 w-fit" role="tablist" aria-label="Show">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn("rounded-md px-3 py-1 text-[13.5px] transition-colors", view === v.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
            {v.id !== "all" && <span className="ml-1.5 text-[12px] text-muted-foreground tabular-nums">{v.id === "done" ? count("done") + count("cancelled") : count(v.id)}</span>}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {loading && !data ? (
        <div className="mt-5 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : shown.length ? (
        <ul className="mt-5 space-y-3">
          {shown.map((g) => (
            <li key={g.id}>
              <Link href={`/app/goals/${g.id}`} className="block rounded-lg border bg-card px-4 py-3.5 transition-colors hover:border-input">
                <div className="flex items-start gap-2.5">
                  <GoalDot color={g.color} className="mt-2" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-medium">{g.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
                      <Chip>{HORIZON_LABEL[g.horizon]}</Chip>
                      {g.category && <Chip>{g.category.name}</Chip>}
                      <PriorityText priority={g.priority} />
                      {g.status !== "active" && <Chip className="font-medium text-foreground">{GOAL_STATUS_LABEL[g.status]}</Chip>}
                    </div>
                  </div>
                  <span className="text-[22px] leading-none font-medium tabular-nums">{pct(g.progress.percent)}</span>
                </div>
                <ProgressBar percent={g.progress.percent} className="mt-3" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-[12.5px] text-muted-foreground">
                  <span className="tabular-nums">{progressCounts(g)}</span>
                  <span className={cn("tabular-nums", g.overdue && "text-destructive")}>
                    {daysLeftText(g)}
                    {g.target_date && g.status !== "done" ? ` · ${formatDay(g.target_date, { day: "numeric", month: "short" })}` : ""}
                  </span>
                </div>
                {linkedText(g) && <p className="mt-1 text-[12.5px] text-muted-foreground">{linkedText(g)}</p>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !loading && (
          <div className="group/pupu mt-8 flex items-center gap-3">
            <Pupu size={64} pose="happy" />
            <p className="text-[15px] text-muted-foreground">
              {view === "active" && !goals.length ? (
                <>
                  No goals yet.{" "}
                  <button className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setDialog(true)}>
                    Set your first one
                  </button>
                </>
              ) : (
                "Nothing here."
              )}
            </p>
          </div>
        )
      )}

      <GoalDialog open={dialog} onOpenChange={setDialog} goal={null} categories={data?.categories ?? []} />
    </div>
  );
}
