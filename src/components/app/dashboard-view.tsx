"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, ChevronDown, ListChecks, Loader2, MapPin, Pin, Plus, Repeat, Sprout } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { COLOR_HEX } from "@/lib/colors";
import { addDaysKey, eventDayRange, eventTimeLabel, formatDay, localDateKey, timeOf } from "@/lib/time";
import { formatBaht } from "@/lib/money-types";
import type { CalendarEvent, Summary, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "./event-dialog";
import { TodoItem, dueLabel } from "./todo-list";
import { GoalsToday } from "./goals-today";
import { HabitsToday } from "./habits-today";
import { MessagesCard } from "./messages-card";
import { MoneyCard } from "./money-card";
import { Pupu } from "./pupu";

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Bangkok" }));
  if (h < 5) return "Up late, James?";
  if (h < 12) return "Good morning, James.";
  if (h < 17) return "Good afternoon, James.";
  return "Good evening, James.";
}

/** Today's progress from raw counts: events that can be ticked, habits due today, and tasks due today. */
function todayProgress(data: Summary, today: string) {
  const events = data.todayEvents.filter((e) => !e.repeat_days);
  const dueTasks = data.todosFocus.filter((t) => t.due_date === today);
  const parts = {
    events: { done: events.filter((e) => e.done).length, total: events.length },
    habits: { done: data.habitsToday.filter((h) => h.done).length, total: data.habitsToday.length },
    tasks: { done: dueTasks.filter((t) => t.done).length, total: dueTasks.length },
  };
  const done = parts.events.done + parts.habits.done + parts.tasks.done;
  const total = parts.events.total + parts.habits.total + parts.tasks.total;
  return { parts, done, total };
}

export function DashboardView() {
  const { data, loading, error } = useData(() => api.summary(), []);
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEvent | null }>({ open: false, event: null });
  const openEvent = (event: CalendarEvent | null) => setDialog({ open: true, event });
  const today = data?.today ?? localDateKey();
  const progress = data ? todayProgress(data, today) : null;
  const attentionCount = data ? data.overdue.length + data.overdueTodos.length : 0;
  const allDone = !!progress && progress.total > 0 && progress.done === progress.total && attentionCount === 0;

  return (
    <div>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4 pb-5">
        <p className="motion-rise text-[72px] leading-[0.85] font-semibold tracking-[-0.05em] text-foreground tabular-nums md:text-[96px]">
          {today.slice(8)}
        </p>
        <div className="motion-rise pb-1" style={{ "--d": "90ms" } as React.CSSProperties}>
          <h1 className="text-[22px] font-medium">{formatDay(today, { weekday: "long" })}</h1>
          <p className="text-[15px] text-muted-foreground">{formatDay(today, { month: "long", year: "numeric" })}</p>
        </div>
        <Button className="ml-auto h-9 px-4" onClick={() => openEvent(null)}>
          <Plus /> New event
        </Button>
      </header>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <section className="group/pupu flex items-center gap-4 rounded-lg border bg-card px-4 py-3.5" aria-label="Today's progress">
        <Pupu
          size={48}
          day={Number(today.slice(8))}
          pose={allDone ? "cheer" : "happy"}
          className="motion-pop"
          title={allDone ? "Pupu is cheering: everything today is done" : "Pupu"}
        />
        <div className="min-w-0 flex-1">
          {progress && progress.total > 0 ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="text-[16px] font-medium">{allDone ? "All done for today. Nice work!" : `Today so far: ${progress.done} of ${progress.total} done`}</p>
                <p className="hidden text-[13px] text-muted-foreground sm:block">{greeting()}</p>
              </div>
              <div className="my-2 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${progress.done} of ${progress.total} done`}>
                <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="flex flex-wrap gap-x-4 text-[12.5px] text-muted-foreground tabular-nums">
                {(
                  [
                    { icon: CalendarDays, part: progress.parts.events, label: "events" },
                    { icon: Sprout, part: progress.parts.habits, label: "habits" },
                    { icon: ListChecks, part: progress.parts.tasks, label: "tasks due today" },
                  ] as const
                )
                  .filter((x) => x.part.total > 0)
                  .map(({ icon: Icon, part, label }) => (
                    <span key={label} className="inline-flex items-center gap-1.5" title={`${part.done} of ${part.total} ${label}`} aria-label={`${part.done} of ${part.total} ${label}`}>
                      <Icon className="size-3.5" strokeWidth={1.7} aria-hidden />
                      <b className="font-medium text-foreground">
                        {part.done}/{part.total}
                      </b>
                    </span>
                  ))}
              </p>
            </>
          ) : (
            <p className="text-[15px]">
              <span className="font-medium">{loading && !data ? greeting() : "Nothing scheduled for today."}</span>{" "}
              <span className="text-muted-foreground">{loading && !data ? "" : greeting()}</span>
            </p>
          )}
        </div>
      </section>

      {data && attentionCount > 0 && <NeedsAttention data={data} today={today} onOpenEvent={openEvent} />}

      <div className="mt-9 grid gap-12 lg:grid-cols-[1.35fr_1fr] lg:gap-14">
        <div className="min-w-0">
          <SectionLabel>Today</SectionLabel>
          {loading && !data ? (
            <Skeleton />
          ) : data && data.todayEvents.length ? (
            <ol className="timeline relative pl-[22px] before:absolute before:top-1.5 before:bottom-1.5 before:left-1 before:w-px before:bg-border">
              {data.todayEvents.map((e, i) => (
                <TimelineItem key={`${e.id}:${e.start_at}`} event={e} onOpen={openEvent} index={i} />
              ))}
            </ol>
          ) : (
            <div className="group/pupu flex items-center gap-3 py-2">
              <Pupu size={56} pose="sleepy" />
              <p className="text-[15px] text-muted-foreground">
                No events today.{" "}
                <button className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => openEvent(null)}>
                  Add an event
                </button>
              </p>
            </div>
          )}

          <SectionLabel className="mt-8">Up next</SectionLabel>
          {data?.upcoming.length ? (
            <ul>
              {data.upcoming.map((e) => {
                const [s, en] = eventDayRange(e);
                const dayLabel = s === addDaysKey(today, 1) ? "Tomorrow" : `${formatDay(s, { weekday: "short" })} ${Number(s.slice(8))}`;
                const right = e.all_day ? (s === en ? "All day" : `${daysBetween(s, en) + 1} days`) : timeOf(e.start_at);
                return (
                  <li key={`${e.id}:${e.start_at}`} className="border-t">
                    <button
                      onClick={() => openEvent(e)}
                      className="grid w-full grid-cols-[84px_1fr_auto] items-baseline gap-3 py-3 text-left text-[15px] transition-colors hover:bg-muted/40"
                    >
                      <span className="text-muted-foreground">{dayLabel}</span>
                      <span className="truncate">
                        <span className="mr-2 inline-block size-[7px] -translate-y-px rounded-full" style={{ background: COLOR_HEX[e.color] }} />
                        <span className="strike-line" data-done={e.done}>
                          {e.title}
                        </span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">{right}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !loading && <Empty>Nothing in the next 7 days.</Empty>
          )}
        </div>

        <div className="min-w-0 space-y-8">
          {data?.habitsToday.length ? <HabitsToday habits={data.habitsToday} /> : null}
          {data?.goalsActive.length ? <GoalsToday goals={data.goalsActive} /> : null}
          <div>
            <SectionLabel>
              Tasks <span className="ml-1.5 font-normal">· due today and high priority</span>
              <Link href="/app/todos" className="ml-auto font-normal hover:text-brand">
                See all{data?.counts.todosOpen ? ` (${data.counts.todosOpen})` : ""}
              </Link>
            </SectionLabel>
            {data?.todosFocus.length ? (
              <ul>
                {data.todosFocus.map((t) => (
                  <TodoItem key={t.id} todo={t} compact />
                ))}
              </ul>
            ) : (
              !loading && (
                <Empty>
                  Nothing due today.{" "}
                  <Link href="/app/todos" className="font-medium text-brand underline-offset-4 hover:underline">
                    Open your list
                  </Link>
                </Empty>
              )
            )}
          </div>
        </div>
      </div>

      <MoreRow today={today} recentNotes={data?.recentNotes ?? []} />

      <EventDialog
        open={dialog.open}
        event={dialog.event}
        defaultDate={today}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}

/** Overdue tasks and events in one calm box, each tickable. Only shown when there is something. */
function NeedsAttention({ data, today, onOpenEvent }: { data: Summary; today: string; onOpenEvent: (e: CalendarEvent) => void }) {
  const [all, setAll] = useState(false);
  type Item = { key: string; node: React.ReactNode };
  const items: Item[] = [
    ...data.overdueTodos.map((t: Todo) => ({
      key: `t${t.id}`,
      node: (
        <div className="flex items-center gap-3 py-1.5">
          <Checkbox
            checked={t.done}
            onCheckedChange={async (v) => {
              try {
                await api.updateTodo(t.id, { done: v === true });
                notifyChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't update the task");
              }
            }}
            aria-label={`Mark ${t.title} as done`}
          />
          <span className="min-w-0 flex-1 truncate text-[14.5px]">{t.title}</span>
          <span className="shrink-0 text-[12.5px] text-destructive tabular-nums">
            {t.priority >= 3 ? "High · " : ""}due {dueLabel(t.due_date ?? today, today).toLowerCase()}
          </span>
        </div>
      ),
    })),
    ...data.overdue.map((e) => ({
      key: `e${e.id}`,
      node: (
        <div className="flex items-center gap-3 py-1.5">
          <Checkbox
            checked={e.done}
            onCheckedChange={async (v) => {
              try {
                await api.updateEvent(e.id, { done: v === true });
                notifyChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't update the event");
              }
            }}
            aria-label={`Mark ${e.title} as done`}
          />
          <button type="button" onClick={() => onOpenEvent(e)} className="min-w-0 flex-1 truncate text-left text-[14.5px] hover:underline">
            {e.title}
          </button>
          <span className="shrink-0 text-[12.5px] text-destructive tabular-nums">event, {formatDay(eventDayRange(e)[0], { month: "short", day: "numeric" })}</span>
        </div>
      ),
    })),
  ];
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3" aria-label="Needs attention">
      <h2 className="mb-1 text-[13.5px] font-medium text-destructive">Needs attention · {items.length}</h2>
      <ul>
        {shown.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
      {items.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `Show ${items.length - 3} more`}
        </button>
      )}
    </section>
  );
}

type MoreKey = "money" | "messages" | "note";

/** Money, messages and the quick note, folded into three small cards that open on click. */
function MoreRow({ today, recentNotes }: { today: string; recentNotes: Summary["recentNotes"] }) {
  const [open, setOpen] = useState<MoreKey | null>(null);
  const money = useData(() => api.moneySummary(), []);
  const messages = useData(() => api.messages().catch(() => null), []);
  const unread = messages.data?.unread ?? 0;
  const hasMessages = (messages.data?.messages.length ?? 0) > 0;

  const tiles: { key: MoreKey; label: string; value: string; muted?: boolean }[] = [
    {
      key: "money",
      label: "Money this month",
      value: money.error ? "Unavailable" : money.data ? `${formatBaht(money.data.net)} left` : "…",
      muted: !!money.error,
    },
    { key: "messages", label: "Messages", value: !hasMessages ? "None yet" : unread ? `${unread} new` : "All read", muted: !hasMessages },
    { key: "note", label: "Quick note", value: "Write something…", muted: true },
  ];

  return (
    <section className="mt-12 border-t pt-6" aria-label="More">
      <div className="grid grid-cols-3 gap-2.5">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-expanded={open === t.key}
            onClick={() => setOpen((o) => (o === t.key ? null : t.key))}
            className={cn(
              "rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-input",
              open === t.key && "border-foreground/40",
            )}
          >
            <span className="flex items-center justify-between text-[11.5px] text-muted-foreground">
              {t.label}
              <ChevronDown className={cn("size-3.5 transition-transform", open === t.key && "rotate-180")} />
            </span>
            <span className={cn("mt-0.5 block truncate text-[15px] font-medium", t.muted && "font-normal text-muted-foreground")}>{t.value}</span>
          </button>
        ))}
      </div>

      {open === "money" && (
        <div className="motion-fade mt-4">
          <MoneyCard />
        </div>
      )}
      {open === "messages" && (
        <div className="motion-fade mt-4">
          {hasMessages ? <MessagesCard /> : <Empty>No messages yet. They show up here when someone uses the contact form on your portfolio.</Empty>}
        </div>
      )}
      {open === "note" && (
        <div className="motion-fade mt-4 grid gap-8 md:grid-cols-2">
          <QuickNote today={today} />
          <div>
            <SectionLabel>
              Recent notes
              <Link href="/app/notes" className="ml-auto font-normal hover:text-brand">
                See all
              </Link>
            </SectionLabel>
            {recentNotes.length ? (
              <ul>
                {recentNotes.map((n) => (
                  <li key={n.id} className="border-t">
                    <Link href={`/app/notes?id=${n.id}`} className="block py-2.5 transition-colors hover:bg-muted/40">
                      <span className="flex items-center gap-1.5 text-[15px]">
                        {n.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{n.title}</span>
                      </span>
                      {n.content && <span className="line-clamp-1 text-[13.5px] text-muted-foreground">{n.content}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No notes yet. Write one in the quick note.</Empty>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TimelineItem({
  event,
  onOpen,
  index,
  late,
}: {
  event: CalendarEvent;
  onOpen: (e: CalendarEvent) => void;
  index: number;
  late?: boolean;
}) {
  const delay = { "--d": `${250 + index * 90}ms` } as React.CSSProperties;
  async function toggleDone(done: boolean) {
    try {
      await api.updateEvent(event.id, { done });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the event");
    }
  }
  const [start] = eventDayRange(event);
  return (
    <li className="relative flex items-start gap-3 pb-5 last:pb-1">
      <span
        aria-hidden
        className="motion-pop absolute top-[7px] -left-[22px] size-[9px] rounded-full ring-[3px] ring-background"
        style={{ background: COLOR_HEX[event.color], ...delay }}
      />
      <button type="button" onClick={() => onOpen(event)} className="motion-rise min-w-0 flex-1 text-left" style={delay}>
        <span className={cn("block text-[13px] text-muted-foreground tabular-nums", late && "text-destructive")}>
          {late ? `Overdue since ${formatDay(start, { month: "short", day: "numeric" })}` : eventTimeLabel(event)}
        </span>
        <span className="block text-[17px] font-medium">
          <span className="strike-line" data-done={event.done}>
            {event.title}
          </span>
        </span>
        {event.location && (
          <span className="flex items-center gap-1 text-[13.5px] text-muted-foreground">
            <MapPin className="size-3" /> {event.location}
          </span>
        )}
      </button>
      {event.repeat_days ? (
        <Repeat aria-label="Repeats" className="mt-1.5 size-3.5 text-muted-foreground/60" />
      ) : (
        <Checkbox
          className="mt-1"
          checked={event.done}
          onCheckedChange={(v) => toggleDone(v === true)}
          aria-label={event.done ? `Mark ${event.title} as not done` : `Mark ${event.title} as done`}
        />
      )}
    </li>
  );
}

function QuickNote({ today }: { today: string }) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const text = content.trim();
    if (!text) return;
    setSaving(true);
    try {
      await api.createNote({ title: text.split("\n")[0].slice(0, 80), content: text, note_date: today });
      setContent("");
      toast.success("Note saved");
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group/pupu relative rounded-[14px] border bg-card px-4 pt-3 pb-2.5">
      <Pupu pose="write" size={44} className="pointer-events-none absolute -top-7 right-3" />
      <Textarea
        aria-label="Quick note"
        placeholder="Write something down…"
        rows={3}
        className="min-h-[72px] resize-none border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground" title="⌘/Ctrl + Enter to save">First line is the title</span>
        <Button size="sm" variant={content.trim() ? "default" : "ghost"} className="" onClick={save} disabled={saving || !content.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Save note
        </Button>
      </div>
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-3.5 flex items-center text-[13px] font-medium text-muted-foreground", className)}>{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[15px] text-muted-foreground">{children}</p>;
}

function Skeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
