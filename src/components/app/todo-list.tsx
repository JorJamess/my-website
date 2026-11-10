"use client";

import { useState } from "react";
import { CalendarClock, Loader2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { addDaysKey, formatDay, localDateKey } from "@/lib/time";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const fail = (err: unknown, fallback: string) => toast.error(err instanceof Error ? err.message : fallback);

function dueLabel(due: string, today: string) {
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

export function TodoItem({ todo, compact }: { todo: Todo; compact?: boolean }) {
  const today = localDateKey();
  const late = !todo.done && !!todo.due_date && todo.due_date < today;

  async function patch(input: Parameters<typeof api.updateTodo>[1]) {
    try {
      await api.updateTodo(todo.id, input);
      notifyChanged();
    } catch (err) {
      fail(err, "Couldn't update the task");
    }
  }
  async function remove() {
    try {
      await api.deleteTodo(todo.id);
      notifyChanged();
    } catch (err) {
      fail(err, "Couldn't delete the task");
    }
  }

  return (
    <li className="group flex items-start gap-3 border-t py-2.5">
      <Checkbox
        className="mt-1"
        checked={todo.done}
        onCheckedChange={(v) => patch({ done: v === true })}
        aria-label={todo.done ? `Mark ${todo.title} as not done` : `Mark ${todo.title} as done`}
      />
      <div className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug">
          <span className="strike-line" data-done={todo.done}>
            {todo.title}
          </span>
        </span>
        {(todo.due_date || (!compact && todo.note)) && (
          <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
            {todo.due_date && (
              <span className={cn("inline-flex items-center gap-1 tabular-nums", late && "text-destructive")}>
                <CalendarClock className="size-3" />
                {late ? "Overdue, " : ""}
                {dueLabel(todo.due_date, today)}
              </span>
            )}
            {!compact && todo.note && <span className="truncate">{todo.note}</span>}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => patch({ important: !todo.important })}
        aria-label={todo.important ? "Remove star" : "Star as important"}
        aria-pressed={todo.important}
        className={cn(
          "mt-0.5 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-brand",
          todo.important && "text-brand",
        )}
      >
        <Star className={cn("size-4", todo.important && "fill-current")} />
      </button>
      {!compact && (
        <button
          type="button"
          onClick={remove}
          aria-label={`Delete ${todo.title}`}
          className="mt-0.5 rounded p-0.5 text-muted-foreground/50 opacity-100 transition hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}
