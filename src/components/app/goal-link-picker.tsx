"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ListChecks, NotebookPen, Search, Sprout } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { formatDay, splitLocal } from "@/lib/time";
import type { GoalLinkType } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Result = { type: GoalLinkType; id: string; title: string; hint: string };
const ICON = { task: ListChecks, habit: Sprout, event: CalendarDays, note: NotebookPen } as const;
const TYPE_LABEL = { task: "Task", habit: "Habit", event: "Event", note: "Note" } as const;

/** Search tasks, habits, events and notes, and link one to the goal with a click. */
export function GoalLinkPicker({ open, onOpenChange, goalId, linked }: { open: boolean; onOpenChange: (o: boolean) => void; goalId: string; linked: Set<string> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [just, setJust] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    const id = ++seq.current;
    const t = setTimeout(
      () => {
        api
          .search(term || " ")
          .then(async (r) => {
            if (id !== seq.current) return;
            // an empty box shows what's open right now, so linking is one click
            const habits = term ? r.habits : (await api.habits()).map((h) => ({ id: h.id, title: h.title, archived: false }));
            const todos = term ? r.todos : await api.todos();
            const out: Result[] = [
              ...todos.filter((x) => !x.parent_id).map((x) => ({ type: "task" as const, id: x.id, title: x.title, hint: x.done ? "Task · done" : "Task" })),
              ...habits.map((h) => ({ type: "habit" as const, id: h.id, title: h.title, hint: "Habit" })),
              ...r.events.map((e) => ({ type: "event" as const, id: e.id, title: e.title, hint: `Event · ${formatDay(splitLocal(e.start_at).date, { day: "numeric", month: "short" })}` })),
              ...r.notes.map((n) => ({ type: "note" as const, id: n.id, title: n.title, hint: "Note" })),
            ];
            setResults(out);
          })
          .catch(() => id === seq.current && setResults([]));
      },
      term ? 180 : 0,
    );
    return () => clearTimeout(t);
  }, [q, open]);

  async function link(r: Result) {
    try {
      await api.linkGoal(goalId, { entity_type: r.type, entity_id: r.id });
      setJust((s) => new Set(s).add(`${r.type}:${r.id}`));
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link it");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Link to this goal</DialogTitle>
        <DialogDescription className="sr-only">Search for a task, habit, event or note to link</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4 pr-12">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search to link a task, habit, event or note…"
            aria-label="Search"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[55dvh] overflow-y-auto p-1.5">
          {results === null ? (
            <div className="m-2 h-10 animate-pulse rounded-lg bg-muted" />
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found.</p>
          ) : (
            results.map((r) => {
              const Icon = ICON[r.type];
              const key = `${r.type}:${r.id}`;
              const isLinked = linked.has(key) || just.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isLinked}
                  onClick={() => link(r)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-brand-soft disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px]">{r.title}</span>
                    <span className="block text-xs text-muted-foreground">{r.hint}</span>
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {isLinked ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-3.5" /> Linked
                      </span>
                    ) : (
                      `Link ${TYPE_LABEL[r.type].toLowerCase()}`
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
