"use client";

import { useState } from "react";
import { CalendarClock, ListTree, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { addDaysKey, formatDay, localDateKey } from "@/lib/time";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const fail = (err: unknown, fallback: string) => toast.error(err instanceof Error ? err.message : fallback);

export const PRIORITY_LABEL = ["No priority", "Low", "Medium", "High"] as const;
export const PRIORITY_TEXT = ["", "text-muted-foreground", "text-amber-700 dark:text-amber-400", "text-brand"] as const;

export function dueLabel(due: string, today: string) {
  if (due === today) return "Today";
  if (due === addDaysKey(today, 1)) return "Tomorrow";
  if (due === addDaysKey(today, -1)) return "Yesterday";
  return formatDay(due, { weekday: "short", day: "numeric", month: "short" });
}

/** One line: type a task, press Enter. Optional due date. */
export function AddTodo({ autoFocus, compact }: { autoFocus?: boolean; compact?: boolean }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await api.createTodo({ title: t, due_date: due || undefined });
      setTitle("");
      setDue("");
      notifyChanged();
    } catch (err) {
      fail(err, "Couldn't add the task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={add} className="flex items-center gap-2">
      <Input
        aria-label="New task"
        autoFocus={autoFocus}
        placeholder={compact ? "Add a task" : "Add a task, e.g. Java homework"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-10 flex-1 text-[15px]"
      />
      {!compact && (
        <Input
          aria-label="Due date (optional)"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="hidden h-10 w-[150px] sm:block"
        />
      )}
      <button
        type="submit"
        disabled={!title.trim() || saving}
        className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}Add
      </button>
    </form>
  );
}

async function patch(id: string, input: Parameters<typeof api.updateTodo>[1]) {
  try {
    await api.updateTodo(id, input);
    notifyChanged();
  } catch (err) {
    fail(err, "Couldn't update the task");
  }
}

/**
 * A task row. On the Today page (`compact`) it is just a checkbox, title and due date.
 * On the To do page it also shows priority, status, category and its subtasks, and opens the editor on click.
 */
export function TodoItem({
  todo,
  compact,
  subtasks = [],
  onOpen,
}: {
  todo: Todo;
  compact?: boolean;
  subtasks?: Todo[];
  onOpen?: (t: Todo) => void;
}) {
  const today = localDateKey();
  const late = !todo.done && !!todo.due_date && todo.due_date < today;
  const doneSubs = subtasks.filter((s) => s.done).length;

  const title = (
    <span className="block text-[15px] leading-snug">
      <span className="strike-line" data-done={todo.done}>
        {todo.title}
      </span>
    </span>
  );

  return (
    <li className="border-t py-2.5">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-1"
          checked={todo.done}
          onCheckedChange={(v) => patch(todo.id, { done: v === true })}
          aria-label={todo.done ? `Mark ${todo.title} as not done` : `Mark ${todo.title} as done`}
        />
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button type="button" onClick={() => onOpen(todo)} className="block w-full text-left hover:text-brand">
              {title}
            </button>
          ) : (
            title
          )}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground">
            {todo.priority >= (compact ? 3 : 1) && (
              <span className={cn("inline-flex items-center gap-1 font-medium", PRIORITY_TEXT[todo.priority])}>
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {PRIORITY_LABEL[todo.priority]}
              </span>
            )}
            {!compact && todo.status === "doing" && <span className="rounded-md bg-muted px-1.5 text-[12px] font-medium text-foreground">Doing</span>}
            {!compact && todo.category && <span className="rounded-md bg-muted px-1.5 text-[12px]">{todo.category.name}</span>}
            {todo.due_date && (
              <span className={cn("inline-flex items-center gap-1 tabular-nums", late && "text-destructive")}>
                <CalendarClock className="size-3" />
                {late ? "Overdue, " : ""}
                {dueLabel(todo.due_date, today)}
              </span>
            )}
            {!compact && subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ListTree className="size-3" />
                {doneSubs}/{subtasks.length}
              </span>
            )}
            {!compact && todo.note && <span className="max-w-full truncate">{todo.note}</span>}
          </span>
        </div>
      </div>

      {!compact && subtasks.length > 0 && (
        <ul className="mt-1.5 ml-[30px] space-y-0.5">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5 py-0.5">
              <Checkbox
                className="mt-0.5 size-[15px]"
                checked={s.done}
                onCheckedChange={(v) => patch(s.id, { done: v === true })}
                aria-label={s.done ? `Mark ${s.title} as not done` : `Mark ${s.title} as done`}
              />
              <span className="text-[14px] leading-snug">
                <span className="strike-line" data-done={s.done}>
                  {s.title}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
