"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ListChecks, NotebookPen, Search, Sprout, Target } from "lucide-react";
import { api } from "@/lib/client/api";
import { eventTimeLabel, formatDay, splitLocal } from "@/lib/time";
import type { CalendarEvent, Note, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EventDialog } from "./event-dialog";

type Results = {
  events: CalendarEvent[];
  notes: Note[];
  todos: Todo[];
  habits: { id: string; title: string; archived: boolean }[];
  goals: { id: string; title: string; status: string }[];
};
type Item = { key: string; icon: typeof Search; title: string; hint: string; go: () => void };

export function SearchButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <Search className="size-4" strokeWidth={1.7} />
      <span>Search</span>
      <kbd className="ml-auto font-mono text-[11px] text-muted-foreground/70">⌘K</kbd>
    </button>
  );
}

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [active, setActive] = useState(0);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      api
        .search(term)
        .then((r) => id === seq.current && (setRes(r), setActive(0)))
        .catch(() => id === seq.current && setRes({ events: [], notes: [], todos: [], habits: [], goals: [] }));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const close = () => {
    onOpenChange(false);
    setQ("");
    setRes(null);
  };

  const shown = q.trim() ? res : null;
  const items: Item[] = shown
    ? [
        ...shown.events.map((e) => ({
          key: `e${e.id}`,
          icon: CalendarDays,
          title: e.title,
          hint: `${formatDay(splitLocal(e.start_at).date, { day: "numeric", month: "short" })} · ${eventTimeLabel(e)}`,
          go: () => {
            close();
            setEvent(e);
          },
        })),
        ...shown.goals.map((g) => ({
          key: `g${g.id}`,
          icon: Target,
          title: g.title,
          hint: g.status === "active" ? "Goal" : `Goal · ${g.status}`,
          go: () => {
            close();
            router.push(`/app/goals/${g.id}`);
          },
        })),
        ...shown.habits.map((h) => ({
          key: `h${h.id}`,
          icon: Sprout,
          title: h.title,
          hint: h.archived ? "Habit · archived" : "Habit",
          go: () => {
            close();
            router.push("/app/habits");
          },
        })),
        ...shown.todos.map((t) => ({
          key: `t${t.id}`,
          icon: ListChecks,
          title: t.title,
          hint: t.done ? "To do · done" : "To do",
          go: () => {
            close();
            router.push("/app/todos");
          },
        })),
        ...shown.notes.map((n) => ({
          key: `n${n.id}`,
          icon: NotebookPen,
          title: n.title,
          hint: n.content.slice(0, 60) || "Note",
          go: () => {
            close();
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/app/notes?id=${n.id}`; // full load so the notes page re-reads ?id
          },
        })),
      ]
    : [];

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.go();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search goals, habits, events, to-dos and notes</DialogDescription>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search goals, habits, events, to-dos and notes…"
              aria-label="Search"
              className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-[52dvh] overflow-y-auto p-1.5">
            {!q.trim() ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type to search everything.</p>
            ) : shown && items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found for “{q.trim()}”.</p>
            ) : (
              items.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={it.go}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                    i === active && "bg-brand-soft",
                  )}
                >
                  <it.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px]">{it.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{it.hint}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          {q.trim() && (
            <button
              type="button"
              onClick={() => {
                const term = q.trim();
                close();
                // a full load so the search page reads the query from the address
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = `/app/search?q=${encodeURIComponent(term)}`;
              }}
              className="flex w-full items-center justify-between border-t px-4 py-2.5 text-left text-[13px] text-muted-foreground hover:text-foreground"
            >
              <span>See all results with filters</span>
              <span aria-hidden>→</span>
            </button>
          )}
        </DialogContent>
      </Dialog>
      <EventDialog open={!!event} event={event} onOpenChange={(o) => !o && setEvent(null)} />
    </>
  );
}
