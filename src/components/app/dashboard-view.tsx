"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, MapPin, Pin, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { COLOR_HEX } from "@/lib/colors";
import { addDaysKey, eventDayRange, eventTimeLabel, formatDay, localDateKey, timeOf } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "./event-dialog";
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

function summaryLine(c: { thisWeek: number; doneThisWeek: number }, overdue: number) {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  let line = `This week you have ${n(c.thisWeek, "event")}`;
  if (c.doneThisWeek) line += `, ${c.doneThisWeek} done`;
  if (overdue) line += `, and ${n(overdue, "overdue event")} from before`;
  return `${line}.`;
}

export function DashboardView() {
  const { data, loading, error } = useData(() => api.summary(), []);
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEvent | null }>({ open: false, event: null });
  const openEvent = (event: CalendarEvent | null) => setDialog({ open: true, event });
  const today = data?.today ?? localDateKey();
  const allDone = !!data && data.todayEvents.length > 0 && data.todayEvents.every((e) => e.done) && data.overdue.length === 0;

  return (
    <div>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4 border-b pb-7">
        <p className="motion-rise text-[72px] leading-[0.85] font-semibold tracking-[-0.05em] text-brand tabular-nums md:text-[96px]">
          {today.slice(8)}
        </p>
        <div className="motion-rise pb-1" style={{ "--d": "90ms" } as React.CSSProperties}>
          <h1 className="text-[22px] font-medium">{formatDay(today, { weekday: "long" })}</h1>
          <p className="text-[15px] text-muted-foreground">{formatDay(today, { month: "long", year: "numeric" })}</p>
        </div>
        <Button className="ml-auto h-9 rounded-full px-4" onClick={() => openEvent(null)}>
          <Plus /> New event
        </Button>
      </header>

      <div className="group/pupu flex items-center gap-3 pt-4 pb-8">
        <Pupu
          size={44}
          day={Number(today.slice(8))}
          pose={allDone ? "cheer" : "happy"}
          className="motion-pop"
          title={allDone ? "Pupu is cheering: everything today is done" : "Pupu"}
        />
        <p className="text-[15px] text-muted-foreground">
          <span className="font-medium text-foreground">{allDone ? "All done for today. Nice work!" : greeting()}</span>{" "}
          {data ? summaryLine(data.counts, data.overdue.length) : ""}
        </p>
      </div>
      {error && <p className="-mt-4 mb-6 text-sm text-destructive">{error}</p>}

      <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr] lg:gap-14">
        <div className="min-w-0">
          <SectionLabel>Today</SectionLabel>
          {loading && !data ? (
            <Skeleton />
          ) : data && (data.todayEvents.length || data.overdue.length) ? (
            <ol className="timeline relative pl-[22px] before:absolute before:top-1.5 before:bottom-1.5 before:left-1 before:w-px before:bg-border">
              {data.overdue.map((e, i) => (
                <TimelineItem key={e.id} event={e} onOpen={openEvent} index={i} late />
              ))}
              {data.todayEvents.map((e, i) => (
                <TimelineItem key={e.id} event={e} onOpen={openEvent} index={data.overdue.length + i} />
              ))}
            </ol>
          ) : (
            <div className="group/pupu flex items-center gap-3 py-2">
              <Pupu size={56} pose="sleepy" />
              <p className="text-[15px] text-muted-foreground">
                Nothing scheduled today.{" "}
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
                  <li key={e.id} className="border-t">
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
          <MessagesCard />
          <div>
            <SectionLabel>Money this month</SectionLabel>
            <MoneyCard />
          </div>
          <div>
            <SectionLabel>Quick note</SectionLabel>
            <QuickNote today={today} />
          </div>
          <div>
            <SectionLabel>
              Recent notes
              <Link href="/app/notes" className="ml-auto font-normal hover:text-brand">
                See all
              </Link>
            </SectionLabel>
            {data?.recentNotes.length ? (
              <ul>
                {data.recentNotes.map((n) => (
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
              <Empty>No notes yet. Write one in the quick note above.</Empty>
            )}
          </div>
        </div>
      </div>

      <EventDialog
        open={dialog.open}
        event={dialog.event}
        defaultDate={today}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
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
      <Checkbox
        className="mt-1"
        checked={event.done}
        onCheckedChange={(v) => toggleDone(v === true)}
        aria-label={event.done ? `Mark ${event.title} as not done` : `Mark ${event.title} as done`}
      />
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
        <Button size="sm" variant={content.trim() ? "default" : "ghost"} className="rounded-full" onClick={save} disabled={saving || !content.trim()}>
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
