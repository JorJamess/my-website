"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { TODO_PRIORITIES, type Category, type Todo, type TodoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { KindHint } from "./kind-hint";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "./select-field";
import { PRIORITY_LABEL } from "./todo-list";

const STATUSES: { id: TodoStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

type Form = { title: string; note: string; due: string; priority: number; status: TodoStatus; category: string };
const NEW_CATEGORY = "__new__";

function initial(t: Todo | null): Form {
  return {
    title: t?.title ?? "",
    note: t?.note ?? "",
    due: t?.due_date ?? "",
    priority: t?.priority ?? 0,
    status: t?.status ?? "todo",
    category: t?.category?.name ?? "",
  };
}

const pill = (on: boolean) =>
  cn(
    "h-8 rounded-full border px-3 text-[13px] transition-colors",
    on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
  );

export function TodoDialog({
  open,
  onOpenChange,
  todo,
  subtasks,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = create a new task */
  todo: Todo | null;
  subtasks: Todo[];
  categories: Category[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <TodoForm key={todo ? `${todo.id}:${todo.updated_at}` : "new"} todo={todo} subtasks={subtasks} categories={categories} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TodoForm({ todo, subtasks, categories, onClose }: { todo: Todo | null; subtasks: Todo[]; categories: Category[]; onClose: () => void }) {
  const [f, setF] = useState<Form>(() => initial(todo));
  const [newCategory, setNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const isSub = !!todo?.parent_id;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: f.title.trim(),
        note: f.note.trim() || null,
        due_date: f.due || null,
        priority: TODO_PRIORITIES[f.priority],
        status: f.status,
        category: f.category.trim() || null,
      };
      if (todo) await api.updateTodo(todo.id, payload);
      else await api.createTodo({ ...payload, note: payload.note ?? undefined, due_date: payload.due_date ?? undefined });
      toast.success(todo ? "Task updated" : "Task added");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the task");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!todo) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      await api.deleteTodo(todo.id);
      toast.success(subtasks.length ? "Task and its subtasks deleted" : "Task deleted");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the task");
    } finally {
      setSaving(false);
    }
  }

  async function addSub(e: React.FormEvent) {
    e.preventDefault();
    const t = subTitle.trim();
    if (!t || !todo) return;
    try {
      await api.createTodo({ title: t, parent_id: todo.id });
      setSubTitle("");
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the subtask");
    }
  }

  async function subAction(fn: () => Promise<unknown>) {
    try {
      await fn();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the subtask");
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{todo ? (isSub ? "Edit subtask" : "Edit task") : "New task"}</DialogTitle>
        <DialogDescription>Tasks have no fixed time. Add a due date if there&rsquo;s a deadline.</DialogDescription>
      </DialogHeader>
      {!todo && <KindHint current="task" />}

      <div className="space-y-2">
        <Label htmlFor="t-title">Title</Label>
        <Input id="t-title" autoFocus={!todo} placeholder="Java homework" value={f.title} onChange={(e) => set("title", e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" aria-pressed={f.status === s.id} onClick={() => set("status", s.id)} className={pill(f.status === s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Priority</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Priority">
          {PRIORITY_LABEL.map((label, i) => (
            <button key={label} type="button" aria-pressed={f.priority === i} onClick={() => set("priority", i)} className={pill(f.priority === i)}>
              {i === 0 ? "None" : label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="t-due">Due date</Label>
          <Input id="t-due" type="date" value={f.due} onChange={(e) => set("due", e.target.value)} />
        </div>
        {!isSub && (
          <div className="space-y-2">
            <Label htmlFor="t-cat">Category</Label>
            {newCategory ? (
              <div className="flex gap-1.5">
                <Input id="t-cat" autoFocus placeholder="New category" value={f.category} onChange={(e) => set("category", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" aria-label="Cancel new category" onClick={() => (setNewCategory(false), set("category", todo?.category?.name ?? ""))}>
                  <X />
                </Button>
              </div>
            ) : (
              <SelectField
                id="t-cat"
                value={f.category}
                onChange={(e) => (e.target.value === NEW_CATEGORY ? (setNewCategory(true), set("category", "")) : set("category", e.target.value))}
                className="w-full"
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>New category…</option>
              </SelectField>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="t-note">Notes</Label>
        <Textarea id="t-note" rows={3} value={f.note} onChange={(e) => set("note", e.target.value)} />
      </div>

      {todo && !isSub && (
        <div className="space-y-2">
          <Label>Subtasks {subtasks.length > 0 && <span className="font-normal text-muted-foreground">· {subtasks.filter((s) => s.done).length} of {subtasks.length} done</span>}</Label>
          {subtasks.length > 0 && (
            <ul className="space-y-1">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5">
                  <Checkbox checked={s.done} onCheckedChange={(v) => subAction(() => api.updateTodo(s.id, { done: v === true }))} aria-label={`Mark ${s.title} as done`} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="strike-line" data-done={s.done}>
                      {s.title}
                    </span>
                  </span>
                  <button type="button" onClick={() => subAction(() => api.deleteTodo(s.id))} aria-label={`Delete ${s.title}`} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              aria-label="New subtask"
              placeholder="Add a subtask"
              value={subTitle}
              onChange={(e) => setSubTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSub(e);
              }}
            />
            <Button type="button" variant="outline" onClick={addSub} disabled={!subTitle.trim()}>
              <Plus /> Add
            </Button>
          </div>
        </div>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {todo ? (
          <Button type="button" variant="destructive" onClick={remove} disabled={saving}>
            <Trash2 />
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !f.title.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            Save task
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
