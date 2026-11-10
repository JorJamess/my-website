"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Receipt } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { COLOR_CLASSES } from "@/lib/colors";
import { formatBahtShort, type MoneyDay, type MoneyRecurring } from "@/lib/money-types";
import { addDaysKey, eventDayRange, eventOnDay, formatDay, localDateKey, timeOf, weekdayIndex } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
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

function sortEvents(a: CalendarEvent, b: CalendarEvent) {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return a.start_at.localeCompare(b.start_at);
}

export function CalendarView() {
  const today = localDateKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  // ทิศทางที่เพิ่งเลื่อนเดือน ใช้เลือก animation ของตาราง
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEvent | null; date?: string }>({
    open: false,
    event: null,
  });

  const days = useMemo(() => monthGrid(month), [month]);
  const from = days[0];
  const to = addDaysKey(days[days.length - 1], 1);
  const { data: events, loading } = useData(() => api.events(from, to), [from, to]);
  // ข้อมูลจากแอปเงิน — ถ้าเชื่อมไม่ได้ก็แค่ไม่แสดง (ไม่ให้ปฏิทินพัง)
  const { data: money } = useData(
    () => api.moneyCalendar(from, addDaysKey(to, -1)).catch(() => null),
    [from, to],
  );
  const moneyDays = useMemo(() => new Map<string, MoneyDay>((money?.days ?? []).map((d) => [d.date, d])), [money]);
  const billsByDay = useMemo(() => {
    const map = new Map<string, MoneyRecurring[]>();
    for (const r of money?.recurring ?? []) for (const d of r.dueDates) map.set(d, [...(map.get(d) ?? []), r]);
    return map;
  }, [money]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const [s, en] = eventDayRange(e);
      for (let k = s < from ? from : s, n = 0; k <= en && k < to && n < 62; k = addDaysKey(k, 1), n++) {
        map.set(k, [...(map.get(k) ?? []), e]);
      }
    }
    for (const list of map.values()) list.sort(sortEvents);
    return map;
  }, [events, from, to]);

  const selectedEvents = (events ?? []).filter((e) => eventOnDay(e, selected)).sort(sortEvents);
  const openNew = (date: string) => setDialog({ open: true, event: null, date });
  const openEvent = (event: CalendarEvent) => setDialog({ open: true, event });

  const goto = (delta: number) => {
    const m = shiftMonth(month, delta);
    setDir(delta > 0 ? "next" : "prev");
    setMonth(m);
    setSelected(m === today.slice(0, 7) ? today : `${m}-01`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="min-w-40 text-[26px] font-medium tracking-tight">
            {formatDay(`${month}-01`, { month: "long", year: "numeric" })}
          </h1>
          {loading && <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => goto(-1)}>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const m = today.slice(0, 7);
              if (m !== month) setDir(m > month ? "next" : "prev");
              setMonth(m);
              setSelected(today);
            }}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => goto(1)}>
            <ChevronRight />
          </Button>
          <Button className="ml-1.5 px-4" onClick={() => openNew(selected)}>
            <Plus /> New event
          </Button>
        </div>
      </div>

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
              const shown = list.slice(0, Math.max(0, 3 - bills.length));
              const hidden = list.length - shown.length;
              const isToday = key === today;
              const isSelected = key === selected;
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(key)}
                  onDoubleClick={() => openNew(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(key);
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
                    {hidden > 0 && <span className="px-1 text-[11px] text-muted-foreground">+{hidden} more</span>}
                  </div>
                  {/* dots (mobile) */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 4).map((e) => (
                      <span key={`${e.id}:${e.start_at}`} className={cn("size-1.5 rounded-full", COLOR_CLASSES[e.color].dot)} />
                    ))}
                    {bills.length > 0 && <span className="size-1.5 rounded-full border border-muted-foreground" />}
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

      <EventDialog
        open={dialog.open}
        event={dialog.event}
        defaultDate={dialog.date}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
