"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useColorNames } from "@/lib/client/use-color-names";
import { weekStart } from "@/lib/habits";
import { useData } from "@/lib/client/use-data";
import { COLOR_CLASSES } from "@/lib/colors";
import { formatBahtShort, type MoneyDay, type MoneyRecurring } from "@/lib/money-types";
import { addDaysKey, eventDayRange, eventOnDay, formatDay, localDateKey, timeOf, weekdayIndex } from "@/lib/time";
import type { CalendarEvent, EventColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarLegend, type CalendarFilter } from "./calendar-legend";
import { CalendarTimeView } from "./calendar-time-view";
import { EventDialog } from "./event-dialog";
import { EventRow } from "./event-row";
import { DayMoney } from "./day-money";
import { Pupu } from "./pupu";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // เริ่มวันจันทร์

function monthGrid(month: string) {
  // month = "YYYY-MM"
  const first = `${month}-01`;
  const offset = (weekdayIndex(first) + 6) % 7; // จันทร์ = 0
  const start = addDaysKey(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDaysKey(start, i));
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function weekTitle(first: string, last: string) {
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const end = sameMonth ? formatDay(last, { day: "numeric" }) : formatDay(last, { day: "numeric", month: "short" });
  return `${formatDay(first, { day: "numeric", month: "short" })} – ${end}, ${formatDay(last, { year: "numeric" })}`;
}

function sortEvents(a: CalendarEvent, b: CalendarEvent) {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return a.start_at.localeCompare(b.start_at);
}

type View = "day" | "week" | "month";
const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

function readSaved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function CalendarView() {
  const today = localDateKey();
  // the calendar only renders after login, in the browser, so reading storage during the first render is safe
  const [view, setViewState] = useState<View>(() => {
    if (typeof window === "undefined") return "month";
    const saved = readSaved<View | null>("cal-view", null);
    return saved ?? (window.innerWidth < 768 ? "day" : "month");
  });
  // /app/calendar?date=YYYY-MM-DD&event=ID (from a note link) jumps to that day and opens the event
  const link = useRef<{ date: string | null; event: string | null }>(
    typeof window === "undefined"
      ? { date: null, event: null }
      : (() => {
          const p = new URLSearchParams(window.location.search);
          const d = p.get("date");
          return { date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, event: p.get("event") };
        })(),
  );
  const [anchor, setAnchor] = useState(link.current.date ?? today);
  const [filter, setFilterState] = useState<CalendarFilter>(() =>
    typeof window === "undefined" ? { hidden: [], tasks: true, milestones: true } : readSaved("cal-filter", { hidden: [], tasks: true, milestones: true }),
  );
  const colorNames = useColorNames();
  const setView = (v: View) => (setViewState(v), save("cal-view", v));
  const setFilter = (f: CalendarFilter) => (setFilterState(f), save("cal-filter", f));

  const month = anchor.slice(0, 7);
  const selected = anchor;
  // ทิศทางที่เพิ่งเลื่อน ใช้เลือก animation ของตาราง
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEvent | null; date?: string; time?: string }>({
    open: false,
    event: null,
  });

  // the days on screen for the current view
  const days = useMemo(() => {
    if (view === "month") return monthGrid(month);
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart(anchor), i));
    return [anchor];
  }, [view, month, anchor]);
  const from = days[0];
  const to = addDaysKey(days[days.length - 1], 1);
  const { data: allEvents, loading } = useData(() => api.events(from, to), [from, to]);
  const { data: items } = useData(() => api.calendarItems(from, addDaysKey(to, -1)), [from, to]);
  useEffect(() => {
    const want = link.current.event;
    if (!want || !allEvents) return;
    link.current = { date: null, event: null };
    window.history.replaceState(null, "", window.location.pathname);
    const e = allEvents.find((x) => x.id === want);
    if (e) setDialog({ open: true, event: e });
  }, [allEvents]);
  const events = useMemo(() => (allEvents ?? []).filter((e) => !filter.hidden.includes(e.color)), [allEvents, filter.hidden]);
  const usedColors = useMemo(() => new Set<EventColor>((allEvents ?? []).map((e) => e.color)), [allEvents]);
  const shownItems = useMemo(
    () => (items ? { tasks: filter.tasks ? items.tasks : [], milestones: filter.milestones ? items.milestones : [] } : null),
    [items, filter.tasks, filter.milestones],
  );
  // ข้อมูลจากแอปเงิน — ถ้าเชื่อมไม่ได้ก็แค่ไม่แสดง (ไม่ให้ปฏิทินพัง) ใช้เฉพาะมุมมองเดือน
  const { data: money } = useData(
    () => (view === "month" ? api.moneyCalendar(from, addDaysKey(to, -1)).catch(() => null) : Promise.resolve(null)),
    [from, to, view],
  );
  const moneyDays = useMemo(() => new Map<string, MoneyDay>((money?.days ?? []).map((d) => [d.date, d])), [money]);
  const billsByDay = useMemo(() => {
    const map = new Map<string, MoneyRecurring[]>();
    for (const r of money?.recurring ?? []) for (const d of r.dueDates) map.set(d, [...(map.get(d) ?? []), r]);
    return map;
  }, [money]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const [s, en] = eventDayRange(e);
      for (let k = s < from ? from : s, n = 0; k <= en && k < to && n < 62; k = addDaysKey(k, 1), n++) {
        map.set(k, [...(map.get(k) ?? []), e]);
      }
    }
    for (const list of map.values()) list.sort(sortEvents);
    return map;
  }, [events, from, to]);

  const selectedEvents = events.filter((e) => eventOnDay(e, selected)).sort(sortEvents);
  const selectedTasks = (shownItems?.tasks ?? []).filter((t) => t.due_date === selected);
  const selectedMilestones = (shownItems?.milestones ?? []).filter((m) => m.due_date === selected);
  const openNew = (date: string) => setDialog({ open: true, event: null, date });
  const openEvent = (event: CalendarEvent) => setDialog({ open: true, event });

  const goto = (delta: number) => {
    setDir(delta > 0 ? "next" : "prev");
    if (view === "month") {
      const m = shiftMonth(month, delta);
      setAnchor(m === today.slice(0, 7) ? today : `${m}-01`);
    } else setAnchor((a) => addDaysKey(a, delta * (view === "week" ? 7 : 1)));
  };
  const goToday = () => {
    setDir(today > anchor ? "next" : "prev");
    setAnchor(today);
  };

  async function toggleTask(id: string, done: boolean) {
    try {
      await api.updateTodo(id, { done });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the task");
    }
  }
  async function toggleMilestone(goalId: string, id: string, done: boolean) {
    try {
      await api.updateMilestone(goalId, id, { done });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the milestone");
    }
  }

  const title =
    view === "month"
      ? formatDay(`${month}-01`, { month: "long", year: "numeric" })
      : view === "day"
        ? formatDay(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : weekTitle(days[0], days[6]);
  const unit = view;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className={cn("font-medium tracking-tight", view === "month" ? "min-w-40 text-[26px]" : "text-[22px]")}>{title}</h1>
          {loading && <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={cn("rounded-md px-3 py-1 text-[13.5px] transition-colors", view === v.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" aria-label={`Previous ${unit}`} onClick={() => goto(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label={`Next ${unit}`} onClick={() => goto(1)}>
            <ChevronRight />
          </Button>
          <Button className="ml-1.5 px-4" onClick={() => openNew(selected)}>
            <Plus /> New event
          </Button>
        </div>
      </div>

      <CalendarLegend names={colorNames} used={usedColors} filter={filter} onChange={setFilter} />

      {view !== "month" && (
        <CalendarTimeView
          key={view}
          days={days}
          today={today}
          events={events}
          items={shownItems}
          onOpenEvent={openEvent}
          onNewAt={(date, minutes) =>
            setDialog({ open: true, event: null, date, time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` })
          }
          onPickDay={(d) => (setAnchor(d), setView("day"))}
          onToggleTask={toggleTask}
          onToggleMilestone={toggleMilestone}
          onSwipe={(d) => goto(d)}
        />
      )}

      {view === "month" && (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="gap-0 py-0">
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={cn("py-2", i >= 5 && "text-foreground/45")}>
                {d}
              </div>
            ))}
          </div>
          <div
            key={month}
            className={cn(
              "grid grid-cols-7 grid-rows-6",
              dir === "next" && "motion-from-right",
              dir === "prev" && "motion-from-left",
            )}
          >
            {days.map((key, i) => {
              const inMonth = key.startsWith(month);
              const list = byDay.get(key) ?? [];
              const bills = billsByDay.get(key) ?? [];
              const spent = moneyDays.get(key)?.expense ?? 0;
              const dayTasks = (shownItems?.tasks ?? []).filter((t) => t.due_date === key);
              const dayMiles = (shownItems?.milestones ?? []).filter((m) => m.due_date === key);
              const shown = list.slice(0, Math.max(0, 3 - bills.length));
              const extraRoom = Math.max(0, 3 - bills.length - shown.length);
              const extras = [...dayTasks.map((t) => ({ k: `t${t.id}`, label: `☐ ${t.title}`, done: t.done })), ...dayMiles.map((m) => ({ k: `m${m.id}`, label: `◆ ${m.title}`, done: m.done }))];
              const hidden = list.length - shown.length + Math.max(0, extras.length - extraRoom);
              const isToday = key === today;
              const isSelected = key === selected;
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setAnchor(key)}
                  onDoubleClick={() => openNew(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setAnchor(key);
                  }}
                  className={cn(
                    "group relative flex min-h-16 cursor-pointer flex-col gap-0.5 border-b border-r p-1 text-left outline-none transition-colors duration-200 hover:bg-muted/50 focus-visible:bg-muted sm:min-h-24 sm:p-1.5",
                    i % 7 === 6 && "border-r-0",
                    i >= 35 && "border-b-0",
                    !inMonth && "bg-muted/30 text-muted-foreground",
                    isSelected && "bg-brand-soft/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {Number(key.slice(8))}
                    </span>
                    {spent > 0 && (
                      <span className="hidden truncate text-[10px] text-red-600/80 tabular-nums sm:block dark:text-red-400/80" title="Spent this day">
                        −{formatBahtShort(spent)}
                      </span>
                    )}
                  </div>
                  {/* chips (sm+) */}
                  <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {bills.slice(0, 3).map((b) => (
                      <span
                        key={b.id}
                        className="flex items-center gap-1 truncate rounded border border-dashed px-1 py-0.5 text-[11px] leading-tight text-muted-foreground"
                        title={`${b.name} due`}
                      >
                        <Receipt className="size-3 shrink-0" />
                        <span className="truncate">
                          {formatBahtShort(b.amount)} {b.name}
                        </span>
                      </span>
                    ))}
                    {shown.map((e) => (
                      <button
                        key={`${e.id}:${e.start_at}`}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEvent(e);
                        }}
                        className={cn(
                          "truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-transform duration-150 hover:-translate-y-px",
                          COLOR_CLASSES[e.color].chip,
                          e.done && "line-through opacity-60",
                        )}
                        title={e.title}
                      >
                        {!e.all_day && <span className="mr-1 tabular-nums opacity-70">{timeOf(e.start_at)}</span>}
                        {e.title}
                      </button>
                    ))}
                    {extras.slice(0, extraRoom).map((x) => (
                      <span key={x.k} className={cn("truncate rounded border border-dashed px-1 py-0.5 text-[11px] leading-tight text-muted-foreground", x.done && "line-through opacity-60")} title={x.label}>
                        {x.label}
                      </span>
                    ))}
                    {hidden > 0 && <span className="px-1 text-[11px] text-muted-foreground">+{hidden} more</span>}
                  </div>
                  {/* dots (mobile) */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 4).map((e) => (
                      <span key={`${e.id}:${e.start_at}`} className={cn("size-1.5 rounded-full", COLOR_CLASSES[e.color].dot)} />
                    ))}
                    {(bills.length > 0 || dayTasks.length > 0 || dayMiles.length > 0) && <span className="size-1.5 rounded-full border border-muted-foreground" />}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="h-fit lg:sticky lg:top-8">
          <CardHeader>
            <CardTitle key={selected} className="motion-fade">{formatDay(selected, { weekday: "long", day: "numeric", month: "long" })}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="Add an event on this day" onClick={() => openNew(selected)}>
                <Plus />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent key={selected} className="motion-fade space-y-3">
            {(selectedTasks.length > 0 || selectedMilestones.length > 0) && (
              <ul className="space-y-1.5 text-sm">
                {selectedTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5">
                    <Checkbox checked={t.done} onCheckedChange={(v) => toggleTask(t.id, v === true)} aria-label={`Mark ${t.title} as done`} />
                    <span className={cn("min-w-0 flex-1 truncate", t.done && "line-through opacity-60")}>{t.title}</span>
                    <span className="text-xs text-muted-foreground">Task due</span>
                  </li>
                ))}
                {selectedMilestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2.5">
                    <Checkbox checked={m.done} onCheckedChange={(v) => toggleMilestone(m.goal_id, m.id, v === true)} aria-label={`Mark ${m.title} as done`} />
                    <span className={cn("min-w-0 flex-1 truncate", m.done && "line-through opacity-60")}>◆ {m.title}</span>
                    <span className="text-xs text-muted-foreground">{m.goal_title}</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedEvents.length ? (
              <div className="-mx-2">
                {selectedEvents.map((e) => (
                  <EventRow key={`${e.id}:${e.start_at}`} event={e} onOpen={openEvent} />
                ))}
              </div>
            ) : (
              <div className="group/pupu flex flex-col items-center py-5 text-center text-sm text-muted-foreground">
                <Pupu size={64} pose="sleepy" className="mb-2" />
                <p>Nothing on this day.</p>
                <Button variant="link" size="sm" onClick={() => openNew(selected)}>
                  Add an event
                </Button>
              </div>
            )}
            {money && (
              <DayMoney key={selected} date={selected} day={moneyDays.get(selected)} bills={billsByDay.get(selected) ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      )}

      <EventDialog
        open={dialog.open}
        event={dialog.event}
        defaultDate={dialog.date}
        defaultTime={dialog.time}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
