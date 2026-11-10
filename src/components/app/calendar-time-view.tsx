"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COLOR_CLASSES, COLOR_HEX } from "@/lib/colors";
import { layoutDay, minutesLabel } from "@/lib/calendar-layout";
import { eventOnDay, formatDay, splitLocal } from "@/lib/time";
import type { CalendarItems } from "@/modules/calendar/repo";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

export const HOUR_H = 52; // px per hour
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const nowMinutes = () => {
  const t = splitLocal(new Date().toISOString()).time;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

type Props = {
  days: string[];
  today: string;
  events: CalendarEvent[];
  items: CalendarItems | null;
  onOpenEvent: (e: CalendarEvent) => void;
  onNewAt: (day: string, minutes: number) => void;
  onPickDay: (day: string) => void;
  onToggleTask: (id: string, done: boolean) => void;
  onToggleMilestone: (goalId: string, id: string, done: boolean) => void;
  /** -1 = earlier, 1 = later (horizontal swipe on touch screens) */
  onSwipe: (dir: -1 | 1) => void;
};

/** Day and week views: a strip for all-day things, tasks and milestones, then a 24-hour grid. */
export function CalendarTimeView({ days, today, events, items, onOpenEvent, onNewAt, onPickDay, onToggleTask, onToggleMilestone, onSwipe }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState(nowMinutes);
  const single = days.length === 1;
  const cols = `46px repeat(${days.length}, minmax(0, 1fr))`;
  const first = days[0];

  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  // open on the working part of the day: a bit above "now" when today is visible, else 7:00
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = days.includes(today) ? nowMinutes() - 90 : 7 * 60;
    el.scrollTop = Math.max(0, (target / 60) * HOUR_H);
    // only when the visible days change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, days.length]);

  return (
    <div
      className="overflow-hidden rounded-lg border bg-card"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) onSwipe(dx < 0 ? 1 : -1);
      }}
    >
      {/* day headers */}
      <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPickDay(d)}
            className="border-l py-2 text-center text-[12px] text-muted-foreground transition-colors hover:bg-muted/50"
            aria-label={`Open ${formatDay(d, { weekday: "long", day: "numeric", month: "long" })}`}
          >
            {formatDay(d, { weekday: "short" })}
            <span className={cn("mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-[15px] font-medium tabular-nums text-foreground", d === today && "bg-primary text-primary-foreground")}>
              {Number(d.slice(8))}
            </span>
          </button>
        ))}
      </div>

      {/* all-day, tasks and milestones */}
      <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
        <div className="flex items-start justify-end px-1.5 pt-1.5 text-[10px] text-muted-foreground">All day</div>
        {days.map((d) => {
          const allDay = events.filter((e) => e.all_day && eventOnDay(e, d));
          const tasks = (items?.tasks ?? []).filter((t) => t.due_date === d);
          const miles = (items?.milestones ?? []).filter((m) => m.due_date === d);
          const total = allDay.length + tasks.length + miles.length;
          const cap = single ? 99 : 3;
          let used = 0;
          const room = () => used++ < cap;
          return (
            <div key={d} className="flex min-h-11 min-w-0 flex-col gap-0.5 border-l p-1">
              {allDay.map((e) =>
                room() ? (
                  <button
                    key={`${e.id}:${e.start_at}`}
                    type="button"
                    onClick={() => onOpenEvent(e)}
                    className={cn("truncate rounded px-1.5 py-0.5 text-left text-[11.5px] leading-tight", COLOR_CLASSES[e.color].chip, e.done && "line-through opacity-60")}
                    title={e.title}
                  >
                    {e.title}
                  </button>
                ) : null,
              )}
              {tasks.map((t) =>
                room() ? (
                  <div
                    key={t.id}
                    className={cn(
                      "flex min-w-0 items-center gap-1 rounded border border-dashed px-1 py-0.5 text-[11.5px] leading-tight",
                      t.priority >= 3 ? "border-brand/60 text-brand" : "text-muted-foreground",
                      t.done && "opacity-60",
                    )}
                  >
                    <Checkbox className="size-3 shrink-0" checked={t.done} onCheckedChange={(v) => onToggleTask(t.id, v === true)} aria-label={`Mark ${t.title} as done`} />
                    <Link href="/app/todos" className={cn("truncate", t.done && "line-through")} title={`Task: ${t.title}`}>
                      {t.title}
                    </Link>
                  </div>
                ) : null,
              )}
              {miles.map((m) =>
                room() ? (
                  <div key={m.id} className={cn("flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] leading-tight", m.done && "opacity-60")}>
                    <Checkbox className="size-3 shrink-0" checked={m.done} onCheckedChange={(v) => onToggleMilestone(m.goal_id, m.id, v === true)} aria-label={`Mark milestone ${m.title} as done`} />
                    <Link href={`/app/goals/${m.goal_id}`} className={cn("truncate", m.done && "line-through")} title={`${m.goal_title}: ${m.title}`}>
                      <span style={{ color: COLOR_HEX[m.color] }} aria-hidden>
                        ◆{" "}
                      </span>
                      {m.title}
                    </Link>
                  </div>
                ) : null,
              )}
              {total > cap && <span className="px-1 text-[11px] text-muted-foreground">+{total - cap} more</span>}
            </div>
          );
        })}
      </div>

      {/* 24-hour grid */}
      <div ref={scroller} className="relative max-h-[64vh] overflow-y-auto overscroll-contain" tabIndex={0} aria-label="Hours of the day">
        <div className="grid" style={{ gridTemplateColumns: cols, height: HOUR_H * 24 }}>
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10.5px] text-muted-foreground tabular-nums" style={{ top: h * HOUR_H }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutDay(events, d);
            return (
              <div
                key={d}
                className={cn("relative border-l", d === today && "bg-muted/30")}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes = Math.floor((((e.clientY - rect.top) / HOUR_H) * 60) / 30) * 30;
                  onNewAt(d, Math.max(0, Math.min(23 * 60 + 30, minutes)));
                }}
              >
                {HOURS.slice(1).map((h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: h * HOUR_H }} />
                ))}
                {placed.map((p) => {
                  const top = (p.startMin / 60) * HOUR_H;
                  const height = Math.max(20, ((p.endMin - p.startMin) / 60) * HOUR_H - 2);
                  const e = p.event;
                  return (
                    <button
                      key={`${e.id}:${e.start_at}`}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpenEvent(e);
                      }}
                      title={`${e.title}, ${minutesLabel(p.startMin)}–${minutesLabel(p.endMin)}`}
                      className={cn("absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11.5px] leading-tight transition-shadow hover:shadow-sm", COLOR_CLASSES[e.color].chip, e.done && "line-through opacity-60")}
                      style={{
                        top,
                        height,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        borderLeftColor: COLOR_HEX[e.color],
                      }}
                    >
                      <span className="block truncate font-medium">{e.title}</span>
                      {height > 34 && (
                        <span className="block truncate opacity-75 tabular-nums">
                          {minutesLabel(p.startMin)}–{minutesLabel(p.endMin)}
                          {e.repeat_days ? " ↻" : ""}
                        </span>
                      )}
                      {height > 58 && e.location && <span className="block truncate opacity-75">{e.location}</span>}
                    </button>
                  );
                })}
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-brand" style={{ top: (now / 60) * HOUR_H }}>
                    <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-brand" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
