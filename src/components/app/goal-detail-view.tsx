"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CalendarDays, Link2, ListChecks, NotebookPen, Pencil, Plus, Sprout, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatDay, splitLocal } from "@/lib/time";
import { GOAL_STATUSES, type GoalLinkType, type GoalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Chip, daysLeftText, GOAL_STATUS_LABEL, GoalDot, HORIZON_LABEL, PriorityText, pct, ProgressBar } from "./goal-bits";
import { GoalDialog } from "./goal-dialog";
import { GoalLinkPicker } from "./goal-link-picker";
import { Pupu } from "./pupu";
import { SelectField } from "./select-field";
import { dueLabel } from "./todo-list";
import { localDateKey } from "@/lib/time";

const fail = (err: unknown, fallback: string) => toast.error(err instanceof Error ? err.message : fallback);

async function run(fn: () => Promise<unknown>, fallback: string) {
  try {
    await fn();
    notifyChanged();
  } catch (err) {
    fail(err, fallback);
  }
}

export function GoalDetailView({ id }: { id: string }) {
  const { data, loading, error } = useData(() => api.goal(id), [id]);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [msTitle, setMsTitle] = useState("");
  const [msDue, setMsDue] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const goal = data?.goal;

  if (!goal) {
    return (
      <div className="mx-auto max-w-[760px]">
        <BackLink />
        {loading ? (
          <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="group/pupu mt-8 flex items-center gap-3">
            <Pupu size={64} pose="oops" />
            <p className="text-[15px] text-muted-foreground">{error ?? "That goal doesn't exist."}</p>
          </div>
        )}
      </div>
    );
  }

  const linked = new Set<string>([
    ...goal.links.tasks.map((t) => `task:${t.id}`),
    ...goal.links.habits.map((h) => `habit:${h.id}`),
    ...goal.links.events.map((e) => `event:${e.id}`),
    ...goal.links.notes.map((n) => `note:${n.id}`),
  ]);
  const unlink = (type: GoalLinkType, entity_id: string) => run(() => api.unlinkGoal(goal.id, { entity_type: type, entity_id }), "Couldn't unlink it");
  const today = localDateKey();

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    const t = msTitle.trim();
    if (!t) return;
    await run(() => api.addMilestone(goal!.id, { title: t, due_date: msDue || null }), "Couldn't add the milestone");
    setMsTitle("");
    setMsDue("");
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = taskTitle.trim();
    if (!t) return;
    await run(async () => {
      const todo = await api.createTodo({ title: t });
      await api.linkGoal(goal!.id, { entity_type: "task", entity_id: todo.id });
    }, "Couldn't add the task");
    setTaskTitle("");
  }

  const p = goal.progress;

  return (
    <div className="mx-auto max-w-[760px]">
      <BackLink />

      <header className="mt-4 flex items-start gap-3 border-b pb-5">
        <GoalDot color={goal.color} className="mt-3" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{goal.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
            <Chip>{HORIZON_LABEL[goal.horizon]}</Chip>
            {goal.category && <Chip>{goal.category.name}</Chip>}
            <PriorityText priority={goal.priority} />
            {goal.start_date && <span>Started {formatDay(goal.start_date, { day: "numeric", month: "short", year: "numeric" })}</span>}
          </div>
          {goal.description && <p className="mt-3 text-[15px] whitespace-pre-line text-muted-foreground">{goal.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SelectField
            aria-label="Status"
            value={goal.status}
            onChange={(e) => run(() => api.updateGoal(goal.id, { status: e.target.value as GoalStatus }), "Couldn't change the status")}
          >
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {GOAL_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
          <Button variant="outline" size="icon" onClick={() => setEditing(true)} aria-label="Edit goal">
            <Pencil />
          </Button>
        </div>
      </header>

      <section className="mt-5 rounded-lg border bg-card px-4 py-4" aria-label="Progress">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] text-muted-foreground">Progress</p>
            <p className="text-[34px] leading-none font-medium tracking-tight tabular-nums">{pct(p.percent)}</p>
          </div>
          <div className="text-right text-[13px] text-muted-foreground tabular-nums">
            <p className={cn(goal.overdue && "font-medium text-destructive")}>{daysLeftText(goal)}</p>
            {goal.target_date && goal.status !== "done" && <p>Target {formatDay(goal.target_date, { day: "numeric", month: "short", year: "numeric" })}</p>}
          </div>
        </div>
        <ProgressBar percent={p.percent} className="mt-3 h-2" />
        <p className="mt-2 text-[13px] text-muted-foreground tabular-nums">
          {p.milestones.total || p.tasks.total
            ? `${p.milestones.done} of ${p.milestones.total} milestones · ${p.tasks.done} of ${p.tasks.total} linked tasks`
            : "Add milestones or link tasks below, and progress shows up here."}
        </p>
      </section>

      <Section title="Milestones" hint={p.milestones.total ? `${p.milestones.done} of ${p.milestones.total}` : undefined}>
        {goal.milestones.length > 0 && (
          <ul>
            {goal.milestones.map((m) => (
              <li key={m.id} className="group flex items-center gap-3 border-t py-2.5">
                <Checkbox checked={!!m.done_at} onCheckedChange={(v) => run(() => api.updateMilestone(goal.id, m.id, { done: v === true }), "Couldn't update the milestone")} aria-label={`Mark ${m.title} as ${m.done_at ? "not done" : "done"}`} />
                <span className="min-w-0 flex-1 text-[15px]">
                  <span className="strike-line" data-done={!!m.done_at}>
                    {m.title}
                  </span>
                </span>
                {m.due_date && <span className={cn("text-[12.5px] text-muted-foreground tabular-nums", !m.done_at && m.due_date < today && "text-destructive")}>{dueLabel(m.due_date, today)}</span>}
                <button type="button" onClick={() => run(() => api.deleteMilestone(goal.id, m.id), "Couldn't delete the milestone")} aria-label={`Delete ${m.title}`} className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addMilestone} className="flex gap-2 border-t pt-3">
          <Input aria-label="New milestone" placeholder="Add a milestone, e.g. Finish grammar chapters 1 to 10" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} className="flex-1" />
          <Input aria-label="Milestone due date (optional)" type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} className="hidden w-[150px] sm:block" />
          <Button type="submit" variant="outline" disabled={!msTitle.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </Section>

      <Section title="Linked tasks" hint={p.tasks.total ? `${p.tasks.done} of ${p.tasks.total}` : undefined}>
        {goal.links.tasks.length > 0 && (
          <ul>
            {goal.links.tasks.map((t) => (
              <li key={t.id} className="group flex items-center gap-3 border-t py-2.5">
                <Checkbox checked={t.done} onCheckedChange={(v) => run(() => api.updateTodo(t.id, { done: v === true }), "Couldn't update the task")} aria-label={`Mark ${t.title} as ${t.done ? "not done" : "done"}`} />
                <span className="min-w-0 flex-1 text-[15px]">
                  <span className="strike-line" data-done={t.done}>
                    {t.title}
                  </span>
                </span>
                {t.due_date && <span className={cn("text-[12.5px] text-muted-foreground tabular-nums", !t.done && t.due_date < today && "text-destructive")}>{dueLabel(t.due_date, today)}</span>}
                <UnlinkButton label={t.title} onClick={() => unlink("task", t.id)} />
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addTask} className="flex gap-2 border-t pt-3">
          <Input aria-label="New task for this goal" placeholder="Add a task for this goal, e.g. Study 20 vocabulary words" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="flex-1" />
          <Button type="submit" variant="outline" disabled={!taskTitle.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </Section>

      <Section title="Habits, events and notes">
        <ul>
          {goal.links.habits.map((h) => (
            <LinkRow key={h.id} icon={Sprout} href="/app/habits" title={h.title} meta={`${h.current_streak} in a row${h.rate_30d === null ? "" : ` · ${Math.round(h.rate_30d * 100)}% last 30 days`}${h.archived ? " · archived" : ""}`} onUnlink={() => unlink("habit", h.id)} />
          ))}
          {goal.links.events.map((e) => (
            <LinkRow key={e.id} icon={CalendarDays} href="/app/calendar" title={e.title} meta={formatDay(splitLocal(e.start_at).date, { weekday: "short", day: "numeric", month: "short" })} onUnlink={() => unlink("event", e.id)} />
          ))}
          {goal.links.notes.map((n) => (
            <LinkRow key={n.id} icon={NotebookPen} href={`/app/notes?id=${n.id}`} title={n.title} meta="Note" hardLink onUnlink={() => unlink("note", n.id)} />
          ))}
        </ul>
        {!goal.links.habits.length && !goal.links.events.length && !goal.links.notes.length && (
          <p className="border-t py-3 text-[14px] text-muted-foreground">Nothing linked yet. Link a habit that builds toward this goal, the sessions you plan, or notes you keep.</p>
        )}
        <div className="border-t pt-3">
          <Button variant="outline" onClick={() => setPicker(true)}>
            <Link2 /> Link something
          </Button>
        </div>
      </Section>

      <GoalDialog open={editing} onOpenChange={setEditing} goal={goal} categories={data?.categories ?? []} />
      <GoalLinkPicker open={picker} onOpenChange={setPicker} goalId={goal.id} linked={linked} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/app/goals" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> All goals
    </Link>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 flex items-baseline text-[13px] font-medium text-muted-foreground">
        {title}
        {hint && <span className="ml-1.5 font-normal tabular-nums">· {hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function UnlinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Unlink ${label}`} title="Unlink (keeps the item)" className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
      <Unlink className="size-4" />
    </button>
  );
}

function LinkRow({ icon: Icon, href, title, meta, onUnlink, hardLink }: { icon: typeof ListChecks; href: string; title: string; meta: string; onUnlink: () => void; hardLink?: boolean }) {
  const inner = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{meta}</span>
      </span>
    </>
  );
  return (
    <li className="group flex items-center gap-3 border-t py-2.5">
      {hardLink ? (
        // notes read ?id= when the page loads, so a full navigation is needed
        <a href={href} className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand">
          {inner}
        </a>
      ) : (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand">
          {inner}
        </Link>
      )}
      <UnlinkButton label={title} onClick={onUnlink} />
    </li>
  );
}
