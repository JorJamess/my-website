"use client";

import { useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, ListTree } from "lucide-react";
import { localDateKey } from "@/lib/time";
import type { Todo, TodoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dueLabel, PRIORITY_LABEL, PRIORITY_TEXT } from "./todo-list";

const COLUMNS: { id: TodoStatus; label: string; empty: string }[] = [
  { id: "todo", label: "To do", empty: "Nothing waiting" },
  { id: "doing", label: "Doing", empty: "Drag a task here when you start it" },
  { id: "done", label: "Done", empty: "Finished tasks show up here" },
];
const DONE_SHOWN = 8;

/**
 * Three columns, one per status. Drag a card to another column (mouse), or use the arrow buttons
 * on the card (touch and keyboard). `onMove` is the only thing that changes data.
 */
export function TodoBoard({
  todos,
  subsOf,
  onOpen,
  onMove,
}: {
  todos: Todo[];
  subsOf: Map<string, Todo[]>;
  onOpen: (t: Todo) => void;
  onMove: (t: Todo, to: TodoStatus) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TodoStatus | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const today = localDateKey();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((col, ci) => {
        const all = todos.filter((t) => t.status === col.id);
        const cards = col.id === "done" && !showAllDone ? all.slice(0, DONE_SHOWN) : all;
        return (
          <section
            key={col.id}
            aria-label={`${col.label}, ${all.length} task${all.length === 1 ? "" : "s"}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === col.id ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const t = todos.find((x) => x.id === (e.dataTransfer.getData("text/plain") || dragging));
              setOver(null);
              setDragging(null);
              if (t && t.status !== col.id) onMove(t, col.id);
            }}
            className={cn("min-h-40 rounded-lg bg-muted/60 p-2.5 transition-colors", over === col.id && "bg-muted ring-2 ring-foreground/20")}
          >
            <h3 className="mb-2.5 flex items-center justify-between px-1 text-[13px] font-medium">
              {col.label}
              <span className="font-normal text-muted-foreground tabular-nums">{all.length}</span>
            </h3>
            <ul className="space-y-2">
              {cards.map((t) => {
                const subs = subsOf.get(t.id) ?? [];
                const late = !t.done && !!t.due_date && t.due_date < today;
                return (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(t.id);
                    }}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                    className={cn("group cursor-grab rounded-lg border bg-card p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] active:cursor-grabbing", dragging === t.id && "opacity-40")}
                  >
                    <div className="flex items-start gap-2">
                    <button type="button" onClick={() => onOpen(t)} className="block min-w-0 flex-1 text-left">
                      <span className="block text-[14.5px] leading-snug">
                        <span className="strike-line" data-done={t.done}>
                          {t.title}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted-foreground">
                        {t.priority >= 1 && (
                          <span className={cn("inline-flex items-center gap-1 font-medium", PRIORITY_TEXT[t.priority])}>
                            <span className="size-1.5 rounded-full bg-current" aria-hidden />
                            {PRIORITY_LABEL[t.priority]}
                          </span>
                        )}
                        {t.category && <span className="rounded-md bg-muted px-1.5 text-[12px]">{t.category.name}</span>}
                        {t.due_date && (
                          <span className={cn("inline-flex items-center gap-1 tabular-nums", late && "text-destructive")}>
                            <CalendarClock className="size-3" />
                            {dueLabel(t.due_date, today)}
                          </span>
                        )}
                        {subs.length > 0 && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <ListTree className="size-3" />
                            {subs.filter((s) => s.done).length}/{subs.length}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      {ci > 0 && (
                        <button
                          type="button"
                          onClick={() => onMove(t, COLUMNS[ci - 1].id)}
                          aria-label={`Move ${t.title} to ${COLUMNS[ci - 1].label}`}
                          title={`Move to ${COLUMNS[ci - 1].label}`}
                          className="rounded-md border p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronLeft className="size-3.5" />
                        </button>
                      )}
                      {ci < COLUMNS.length - 1 && (
                        <button
                          type="button"
                          onClick={() => onMove(t, COLUMNS[ci + 1].id)}
                          aria-label={`Move ${t.title} to ${COLUMNS[ci + 1].label}`}
                          title={`Move to ${COLUMNS[ci + 1].label}`}
                          className="rounded-md border p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronRight className="size-3.5" />
                        </button>
                      )}
                    </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {all.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">{col.empty}</p>}
            {col.id === "done" && all.length > DONE_SHOWN && (
              <button type="button" onClick={() => setShowAllDone((v) => !v)} className="mt-2 w-full text-center text-[12.5px] text-muted-foreground hover:text-foreground">
                {showAllDone ? "Show fewer" : `Show ${all.length - DONE_SHOWN} more`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
