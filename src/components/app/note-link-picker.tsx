"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ListChecks, Search, Target } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { formatDay, splitLocal } from "@/lib/time";
import type { NoteLinkType } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Result = { type: NoteLinkType; id: string; title: string; hint: string };
const ICON = { task: ListChecks, event: CalendarDays, goal: Target } as const;

/** Search tasks, events and goals and link one to the note with a click. */
export function NoteLinkPicker({ open, onOpenChange, noteId, linked, onLinked }: { open: boolean; onOpenChange: (o: boolean) => void; noteId: string; linked: Set<string>; onLinked: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
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
            const todos = term ? r.todos : await api.todos();
            setResults([
              ...r.goals.map((g) => ({ type: "goal" as const, id: g.id, title: g.title, hint: "Goal" })),
              ...todos.filter((x) => !x.parent_id).map((x) => ({ type: "task" as const, id: x.id, title: x.title, hint: x.done ? "Task · done" : "Task" })),
              ...r.events.map((e) => ({ type: "event" as const, id: e.id, title: e.title, hint: `Event · ${formatDay(splitLocal(e.start_at).date, { day: "numeric", month: "short" })}` })),
            ]);
          })
          .catch(() => id === seq.current && setResults([]));
      },
      term ? 180 : 0,
    );
    return () => clearTimeout(t);
  }, [q, open]);

  async function link(r: Result) {
    try {
      await api.linkNote(noteId, { entity_type: r.type, entity_id: r.id });
      onLinked();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link it");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Link to this note</DialogTitle>
        <DialogDescription className="sr-only">Search for a goal, task or event to link</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4 pr-12">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search to link a goal, task or event…"
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
              const isLinked = linked.has(`${r.type}:${r.id}`);
              return (
                <button
                  key={`${r.type}:${r.id}`}
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
                      "Link"
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
