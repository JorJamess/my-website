"use client";

import { useState } from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { COLOR_CLASSES } from "@/lib/colors";
import { scheduleLabel } from "@/lib/habits";
import { formatDay, localDateKey } from "@/lib/time";
import type { HabitDayState, HabitOverview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HabitDialog } from "./habit-dialog";
import { Pupu } from "./pupu";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

const STATE_CLASS: Record<HabitDayState, string> = {
  done: "bg-foreground",
  missed: "bg-brand/15",
  due: "bg-card ring-2 ring-inset ring-brand",
  upcoming: "border border-dashed border-input",
  off: "bg-muted/50",
};
const STATE_LABEL: Record<HabitDayState, string> = {
  done: "done",
  missed: "missed",
  due: "due today",
  upcoming: "coming up",
  off: "not scheduled",
};

export function HabitsView() {
  const { data, loading, error } = useData(() => api.habits(), []);
  const [dialog, setDialog] = useState<{ open: boolean; habit: HabitOverview | null }>({ open: false, habit: null });
  const today = localDateKey();

  const scheduledToday = data?.filter((h) => h.stats.scheduled_today) ?? [];
  const doneToday = scheduledToday.filter((h) => h.stats.done_today).length;
  const best = data?.reduce((m, h) => Math.max(m, h.stats.current_streak), 0) ?? 0;
  const totals = data?.reduce((a, h) => ({ d: a.d + h.stats.last30.done, s: a.s + h.stats.last30.scheduled }), { d: 0, s: 0 });

  return (
    <div className="mx-auto max-w-[760px]">
      <header className="flex items-end gap-4 border-b pb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Habits</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {formatDay(today, { weekday: "long", day: "numeric", month: "long" })}. Tick a habit when you&rsquo;ve done it.
          </p>
        </div>
        <Button className="ml-auto h-9 px-4" onClick={() => setDialog({ open: true, habit: null })}>
          <Plus /> New habit
        </Button>
      </header>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {loading && !data ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : data && data.length ? (
        <>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Done today" value={scheduledToday.length ? `${doneToday} of ${scheduledToday.length}` : "Nothing due"} />
            <Stat label="Best streak now" value={best ? `${best} in a row` : "–"} />
            <Stat label="Last 30 days" value={totals && totals.s ? pct(totals.d / totals.s) : "–"} hint={totals && totals.s ? `${totals.d} of ${totals.s}` : undefined} />
          </div>
          <ul className="mt-5 space-y-3">
            {data.map((h) => (
              <HabitCard key={h.id} habit={h} onEdit={() => setDialog({ open: true, habit: h })} />
            ))}
          </ul>
        </>
      ) : (
        !loading && (
          <div className="group/pupu mt-8 flex items-center gap-3">
            <Pupu size={64} pose="happy" />
            <p className="text-[15px] text-muted-foreground">
              No habits yet.{" "}
              <button className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setDialog({ open: true, habit: null })}>
                Add your first one
              </button>
            </p>
          </div>
        )
      )}

      <HabitDialog open={dialog.open} habit={dialog.habit} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted px-3.5 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[19px] leading-tight font-medium tabular-nums">{value}</p>
      {hint && <p className="text-[12px] text-muted-foreground tabular-nums">{hint}</p>}
    </div>
  );
}

function HabitCard({ habit: h, onEdit }: { habit: HabitOverview; onEdit: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const s = h.stats;
  const week = h.history.slice(-7);

  async function tick(day: string, done: boolean) {
    try {
      await api.checkin(h.id, { day, done });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the check-in");
    }
  }

  return (
    <li className="rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        {s.scheduled_today ? (
          <Checkbox
            className="mt-0.5 size-[22px]"
            checked={s.done_today}
            onCheckedChange={(v) => tick(localDateKey(), v === true)}
            aria-label={s.done_today ? `Undo ${h.title} for today` : `Mark ${h.title} done today`}
          />
        ) : (
          <span className="mt-0.5 size-[22px] shrink-0 rounded-[5px] border border-dashed border-input" title="Not scheduled today" aria-label="Not scheduled today" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[16px] font-medium">
            <span className={cn("size-2 shrink-0 rounded-full", COLOR_CLASSES[h.color].dot)} aria-hidden />
            <span className="truncate">{h.title}</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            {scheduleLabel(h)} · <span className="font-medium text-brand tabular-nums">{s.current_streak}</span> in a row · best {s.longest_streak}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${h.title}`}>
          <Pencil />
        </Button>
      </div>

      <div className="mt-3 flex items-end gap-1.5">
        {week.map((d, i) => (
          <div key={d.day} className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
            {LETTERS[i]}
            <span className={cn("block size-[22px] rounded-md", STATE_CLASS[d.state])} title={`${formatDay(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${STATE_LABEL[d.state]}`} />
          </div>
        ))}
        <div className="ml-3 flex flex-1 items-center gap-2 pb-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-foreground" style={{ width: `${Math.round((s.last30.rate ?? 0) * 100)}%` }} />
          </div>
          <span className="w-9 text-right text-[12px] text-muted-foreground tabular-nums">{pct(s.last30.rate)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="tabular-nums">Last 30 days: {s.last30.done} of {s.last30.scheduled} scheduled</span>
        <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className="inline-flex items-center gap-1 hover:text-foreground">
          12 weeks <ChevronDown className={cn("size-3.5 transition-transform", showHistory && "rotate-180")} />
        </button>
      </div>

      {showHistory && (
        <div className="mt-3 border-t pt-3">
          <div
            className="grid max-w-[340px] gap-1"
            style={{ gridAutoFlow: "column", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(7, auto)" }}
          >
            {h.history.map((d) => {
              const today = localDateKey();
              const clickable = d.day <= today && d.day >= h.start_date;
              return (
                <button
                  key={d.day}
                  type="button"
                  disabled={!clickable}
                  onClick={() => tick(d.day, d.state !== "done")}
                  title={`${formatDay(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${STATE_LABEL[d.state]}${clickable ? " (click to change)" : ""}`}
                  aria-label={`${formatDay(d.day)}: ${STATE_LABEL[d.state]}`}
                  className={cn("aspect-square w-full rounded-[4px]", STATE_CLASS[d.state], clickable && "cursor-pointer hover:ring-2 hover:ring-foreground/30")}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Oldest week on the left. Click a past day to fix it.</p>
        </div>
      )}
    </li>
  );
}
