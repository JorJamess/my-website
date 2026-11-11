"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Columns3, List, Plus } from "lucide-react";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import type { Todo, TodoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pupu } from "./pupu";
import { SelectField } from "./select-field";
import { TodoBoard } from "./todo-board";
import { TodoDialog } from "./todo-dialog";
import { AddTodo, TodoItem } from "./todo-list";

type View = "open" | "doing" | "done" | "all";
type Layout = "list" | "board";
type Sort = "smart" | "due" | "priority" | "newest";

const VIEWS: { id: View; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

function sortTodos(list: Todo[], sort: Sort): Todo[] {
  if (sort === "smart") return list; // the server already orders by priority, then due date
  const out = [...list];
  if (sort === "due") out.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || b.priority - a.priority);
  else if (sort === "priority") out.sort((a, b) => b.priority - a.priority || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  else out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return out;
}

export function TodosView() {
  const { data, loading, error } = useData(() => api.todosWithCategories(true), []);
  const [view, setView] = useState<View>("open");
  const [minPriority, setMinPriority] = useState(0);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("smart");
  const [layout, setLayout] = useState<Layout>("list");
  const [moved, setMoved] = useState<Map<string, TodoStatus>>(new Map()); // optimistic moves until the server answers

  // remember the layout on this device (storage can be blocked, so it is optional)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("todos-layout");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "board" || saved === "list") setLayout(saved);
    } catch {}
  }, []);
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem("todos-layout", l);
    } catch {}
  };
  const [dialog, setDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const todos = data?.todos;
  const categories = data?.categories ?? [];

  // /app/todos?id=… (from a note link or a search result) opens that task once
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !todos) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (todos.some((t) => t.id === id)) setDialog({ open: true, id });
  }, [todos]);

  const { tops, boardTops, subsOf, counts } = useMemo(() => {
    const all = todos ?? [];
    const top = all.filter((t) => !t.parent_id);
    const subs = new Map<string, Todo[]>();
    for (const t of all) if (t.parent_id) subs.set(t.parent_id, [...(subs.get(t.parent_id) ?? []), t]);
    const match = (t: Todo) =>
      t.priority >= minPriority &&
      (!category || t.category?.name === category) &&
      (view === "all" || (view === "open" ? !t.done : view === "doing" ? t.status === "doing" : t.done));
    const matchCard = (t: Todo) => t.priority >= minPriority && (!category || t.category?.name === category);
    return {
      boardTops: sortTodos(
        top.filter(matchCard).map((t) => (moved.has(t.id) ? { ...t, status: moved.get(t.id)!, done: moved.get(t.id) === "done" } : t)),
        sort,
      ),
      tops: sortTodos(top.filter(match), sort),
      subsOf: subs,
      counts: { open: top.filter((t) => !t.done).length, doing: top.filter((t) => t.status === "doing").length, done: top.filter((t) => t.done).length },
    };
  }, [todos, view, minPriority, category, sort, moved]);

  async function move(t: Todo, to: TodoStatus) {
    setMoved((m) => new Map(m).set(t.id, to));
    try {
      await api.updateTodo(t.id, { status: to });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move the task");
    } finally {
      // the reload that follows notifyChanged brings the real status; drop the optimistic one either way
      setTimeout(() => setMoved((m) => (m.delete(t.id), new Map(m))), 600);
    }
  }

  const editing = dialog.id ? (todos?.find((t) => t.id === dialog.id) ?? null) : null;
  const filtered = view !== "open" || minPriority > 0 || !!category;

  return (
    <div className={cn("mx-auto", layout === "board" ? "max-w-[1040px]" : "max-w-[760px]")}>
      <header className="flex items-end gap-4 border-b pb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">To do</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Tasks without a fixed time. Ask Claude &ldquo;what should I do first today?&rdquo; and it reads this list.
          </p>
        </div>
        <Button className="ml-auto h-9 shrink-0 px-4" onClick={() => setDialog({ open: true, id: null })}>
          <Plus /> New task
        </Button>
      </header>

      <div className="pt-5 pb-4">
        <AddTodo autoFocus />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Layout">
          {(
            [
              { id: "list", label: "List", icon: List },
              { id: "board", label: "Board", icon: Columns3 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-pressed={layout === id}
              onClick={() => chooseLayout(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13.5px] transition-colors",
                layout === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        {layout === "list" && (
        <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Show">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "rounded-md px-3 py-1 text-[13.5px] transition-colors",
                view === v.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
              {v.id !== "all" && <span className="ml-1.5 text-[12px] text-muted-foreground tabular-nums">{counts[v.id]}</span>}
            </button>
          ))}
        </div>
        )}
        <SelectField aria-label="Priority at least" value={minPriority} onChange={(e) => setMinPriority(Number(e.target.value))}>
          <option value={0}>Any priority</option>
          <option value={3}>High only</option>
          <option value={2}>Medium and up</option>
          <option value={1}>Low and up</option>
        </SelectField>
        {categories.length > 0 && (
          <SelectField aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="ml-auto">
          <option value="smart">Smart order</option>
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
          <option value="newest">Newest</option>
        </SelectField>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : layout === "board" ? (
        <TodoBoard todos={boardTops} subsOf={subsOf} onOpen={(x) => setDialog({ open: true, id: x.id })} onMove={move} />
      ) : tops.length ? (
        <ul className="border-b">
          {tops.map((t) => (
            <TodoItem key={t.id} todo={t} subtasks={subsOf.get(t.id) ?? []} onOpen={(x) => setDialog({ open: true, id: x.id })} />
          ))}
        </ul>
      ) : (
        <div className="group/pupu flex items-center gap-3 py-4">
          <Pupu size={56} pose={counts.done && !filtered ? "cheer" : "sleepy"} />
          <p className="text-[15px] text-muted-foreground">
            {filtered ? "Nothing matches these filters." : counts.done ? "Everything is done. Nice work!" : "Nothing to do yet. Add your first task above."}
          </p>
        </div>
      )}

      <TodoDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        todo={editing}
        subtasks={editing ? (subsOf.get(editing.id) ?? []) : []}
        categories={categories}
      />
    </div>
  );
}
