"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { COLOR_CLASSES } from "@/lib/colors";
import { formatDay } from "@/lib/time";
import type { Analytics } from "@/modules/analytics/repo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, BarChartLabels } from "./bar-chart";
import { ProgressBar } from "./goal-bits";
import { daysLeftText } from "./goal-bits";

type Range = "week" | "month";
const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

function periodLabel(a: Analytics) {
  if (a.range === "month") return formatDay(a.start, { month: "long", year: "numeric" });
  const same = a.start.slice(0, 7) === a.end.slice(0, 7);
  return `${formatDay(a.start, { day: "numeric", month: "short" })} – ${formatDay(a.end, same ? { day: "numeric" } : { day: "numeric", month: "short" })}`;
}

/** "+3 vs last week", "2 fewer than last week" or "Same as last week" */
function countDelta(cur: number, prev: number, range: Range, current: boolean) {
  const then = range === "week" ? (current ? "last week" : "the week before") : current ? "last month" : "the month before";
  if (cur === prev) return `Same as ${then}`;
  return `${cur > prev ? "+" : "−"}${Math.abs(cur - prev)} vs ${then}`;
}

function rateDelta(cur: number | null, prev: number | null, range: Range, current: boolean) {
  if (cur === null || prev === null) return " ";
  const then = range === "week" ? (current ? "last week" : "the week before") : current ? "last month" : "the month before";
  const pts = Math.round((cur - prev) * 100);
  return pts === 0 ? `Same as ${then}` : `${pts > 0 ? "+" : "−"}${Math.abs(pts)} points vs ${then}`;
}

export function InsightsView() {
  const [range, setRange] = useState<Range>("week");
  const [offset, setOffset] = useState(0);
  const { data: a, loading, error } = useData(() => api.analytics(range, offset), [range, offset]);

  const unit = range === "week" ? "week" : "month";

  return (
    <div className="mx-auto max-w-[820px]">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b pb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Insights</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Plain counts from your tasks, habits and goals. No score, just what happened.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Period">
            {(["week", "month"] as const).map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                onClick={() => (setRange(r), setOffset(0))}
                className={cn("rounded-md px-3 py-1 text-[13.5px] capitalize transition-colors", range === r ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mt-4 flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => setOffset((o) => o - 1)} aria-label={`Previous ${unit}`}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} aria-label={`Next ${unit}`}>
          <ChevronRight />
        </Button>
        <p className="ml-2 text-[15px] font-medium tabular-nums">{a ? periodLabel(a) : " "}</p>
        {a && !a.isCurrent && (
          <button className="ml-2 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOffset(0)}>
            Back to this {unit}
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {loading && !a ? (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : a ? (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Tasks completed" value={String(a.tasks.completed)} sub={countDelta(a.tasks.completed, a.tasks.prevCompleted, range, a.isCurrent)} />
            <Card
              label="Due tasks done"
              value={a.tasks.due.total ? `${a.tasks.due.done} of ${a.tasks.due.total}` : "–"}
              sub={a.tasks.due.total ? pct(a.tasks.due.rate) : "Nothing was due"}
            />
            <Card
              label="Habits done"
              value={pct(a.habits.rate)}
              sub={a.habits.scheduled ? `${a.habits.done} of ${a.habits.scheduled} · ${rateDelta(a.habits.rate, a.habits.prevRate, range, a.isCurrent)}` : "No habits scheduled"}
            />
            <Card label="Milestones done" value={String(a.goals.milestonesDone)} sub={countDelta(a.goals.milestonesDone, a.goals.prevMilestonesDone, range, a.isCurrent)} />
          </div>

          <Section title="Tasks" note={`Created ${a.tasks.created} · open now ${a.tasks.open} · overdue now ${a.tasks.overdue}`}>
            <Chart a={a} pick={(d) => d.tasks} label="tasks completed" />
          </Section>

          <Section title="Habits" note={a.habits.list.length ? `${a.habits.checkins} check-in${a.habits.checkins === 1 ? "" : "s"} this ${unit}` : undefined}>
            {a.habits.list.length ? (
              <>
                <Chart a={a} pick={(d) => d.habits} label="habit check-ins" />
                <ul className="mt-5">
                  {a.habits.list.map((h) => (
                    <li key={h.id} className="border-t py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", COLOR_CLASSES[h.color].dot)} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[15px]">{h.title}</span>
                        <span className="text-[13px] text-muted-foreground tabular-nums">
                          {h.scheduled ? `${h.done} of ${h.scheduled}` : "Not scheduled yet"}
                        </span>
                        <span className="w-10 text-right text-[15px] font-medium tabular-nums">{pct(h.rate)}</span>
                      </div>
                      <ProgressBar percent={h.rate} className="mt-2" />
                      <p className="mt-1 text-[12.5px] text-muted-foreground tabular-nums">
                        {h.current_streak} in a row now · best {h.longest_streak}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty>No habits yet. Add one on the Habits page and its consistency shows up here.</Empty>
            )}
          </Section>

          <Section
            title="Goals"
            note={`${a.goals.active} active${a.goals.completed ? ` · ${a.goals.completed} completed this ${unit}` : ""}`}
          >
            {a.goals.progress.length ? (
              <ul>
                {a.goals.progress.map((g) => (
                  <li key={g.id} className="border-t py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", COLOR_CLASSES[g.color].dot)} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{g.title}</span>
                      <span className="text-[15px] font-medium tabular-nums">{pct(g.percent)}</span>
                    </div>
                    <ProgressBar percent={g.percent} className="mt-2" />
                    <p className={cn("mt-1 text-[12.5px] text-muted-foreground tabular-nums", g.overdue && "text-destructive")}>
                      {daysLeftText({ days_left: g.days_left, status: "active", target_date: null })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No active goals. Progress is shown for goals you are working on right now.</Empty>
            )}
          </Section>

          <p className="mt-8 text-[12.5px] text-muted-foreground">
            Habit rates count only the days a habit was scheduled and already over. Today doesn&rsquo;t count against you until it ends.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted px-3.5 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[22px] leading-tight font-medium tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b pb-2">
        <span className="text-[17px] font-medium">{title}</span>
        {note && <span className="text-[13px] text-muted-foreground tabular-nums">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[15px] text-muted-foreground">{children}</p>;
}

function Chart({ a, pick, label }: { a: Analytics; pick: (d: Analytics["days"][number]) => number; label: string }) {
  const month = a.range === "month";
  const bars: Bar[] = a.days.map((d) => ({
    label: month ? String(Number(d.day.slice(8))) : formatDay(d.day, { weekday: "short" }).slice(0, 3),
    value: pick(d),
    title: `${formatDay(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${pick(d)} ${label}`,
    muted: d.day > a.today,
  }));
  const total = bars.reduce((s, b) => s + b.value, 0);
  return (
    <div>
      <BarChart bars={bars} ariaLabel={`${total} ${label} from ${a.start} to ${a.end}, one bar per day`} />
      <BarChartLabels bars={bars} showValues={!month} labelEvery={month ? 5 : 1} />
    </div>
  );
}
