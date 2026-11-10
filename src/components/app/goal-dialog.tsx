"use client";

import { useState } from "react";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES, COLOR_LABELS } from "@/lib/colors";
import { EVENT_COLORS, GOAL_STATUSES, TODO_PRIORITIES, type Category, type EventColor, type GoalHorizon, type GoalOverview, type GoalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KindHint } from "./kind-hint";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_STATUS_LABEL, HORIZON_LABEL } from "./goal-bits";
import { SelectField } from "./select-field";
import { PRIORITY_LABEL } from "./todo-list";

type Form = {
  title: string;
  description: string;
  horizon: GoalHorizon;
  priority: number;
  status: GoalStatus;
  category: string;
  start: string;
  target: string;
  color: EventColor;
};
const NEW_CATEGORY = "__new__";

const initial = (g: GoalOverview | null): Form => ({
  title: g?.title ?? "",
  description: g?.description ?? "",
  horizon: g?.horizon ?? "short",
  priority: g?.priority ?? 0,
  status: g?.status ?? "active",
  category: g?.category?.name ?? "",
  start: g?.start_date ?? "",
  target: g?.target_date ?? "",
  color: g?.color ?? "blue",
});

const pill = (on: boolean) =>
  cn("h-8 rounded-full border px-3 text-[13px] transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground");

export function GoalDialog({ open, onOpenChange, goal, categories }: { open: boolean; onOpenChange: (o: boolean) => void; goal: GoalOverview | null; categories: Category[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && <GoalForm key={goal ? `${goal.id}:${goal.updated_at}` : "new"} goal={goal} categories={categories} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ goal, categories, onClose }: { goal: GoalOverview | null; categories: Category[]; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => initial(goal));
  const [newCategory, setNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const dateProblem = f.start && f.target && f.target < f.start ? "The target date can't be before the start date" : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim() || dateProblem) return;
    setSaving(true);
    try {
      const payload = {
        title: f.title.trim(),
        description: f.description.trim() || null,
        horizon: f.horizon,
        priority: TODO_PRIORITIES[f.priority],
        status: f.status,
        category: f.category.trim() || null,
        start_date: f.start || null,
        target_date: f.target || null,
        color: f.color,
      };
      if (goal) await api.updateGoal(goal.id, payload);
      else {
        const created = await api.createGoal(payload);
        router.push(`/app/goals/${created.id}`);
      }
      toast.success(goal ? "Goal updated" : "Goal added");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the goal");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!goal) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      await api.deleteGoal(goal.id);
      toast.success("Goal deleted. Linked items are kept");
      notifyChanged();
      onClose();
      router.push("/app/goals");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
        <DialogDescription>Progress comes from milestones and the tasks you link, so add those next.</DialogDescription>
      </DialogHeader>
      {!goal && <KindHint current="goal" />}

      <div className="space-y-2">
        <Label htmlFor="g-title">Goal</Label>
        <Input id="g-title" autoFocus={!goal} placeholder="Pass JLPT N4" value={f.title} onChange={(e) => set("title", e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label>Time frame</Label>
        <div className="flex gap-1.5" role="group" aria-label="Time frame">
          {(["short", "long"] as const).map((h) => (
            <button key={h} type="button" aria-pressed={f.horizon === h} onClick={() => set("horizon", h)} className={pill(f.horizon === h)}>
              {HORIZON_LABEL[h]}
            </button>
          ))}
        </div>
      </div>

      {goal && (
        <div className="space-y-2">
          <Label>Status</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
            {GOAL_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={f.status === s} onClick={() => set("status", s)} className={pill(f.status === s)}>
                {GOAL_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

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
          <Label htmlFor="g-start">Start date</Label>
          <Input id="g-start" type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="g-target">Target date</Label>
          <Input id="g-target" type="date" min={f.start || undefined} value={f.target} onChange={(e) => set("target", e.target.value)} />
        </div>
      </div>
      {dateProblem && <p className="text-sm text-destructive">{dateProblem}.</p>}

      <div className="space-y-2">
        <Label htmlFor="g-cat">Category</Label>
        {newCategory ? (
          <div className="flex gap-1.5">
            <Input id="g-cat" autoFocus placeholder="New category" value={f.category} onChange={(e) => set("category", e.target.value)} />
            <Button type="button" variant="ghost" size="icon" aria-label="Cancel new category" onClick={() => (setNewCategory(false), set("category", goal?.category?.name ?? ""))}>
              <X />
            </Button>
          </div>
        ) : (
          <SelectField
            id="g-cat"
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

      <div className="space-y-2">
        <Label htmlFor="g-desc">Why it matters</Label>
        <Textarea id="g-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={COLOR_LABELS[c]}
              aria-label={COLOR_LABELS[c]}
              aria-pressed={f.color === c}
              onClick={() => set("color", c)}
              className={cn("flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition", COLOR_CLASSES[c].dot, f.color === c && "ring-2 ring-foreground/60")}
            >
              {f.color === c && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {goal ? (
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
          <Button type="submit" disabled={saving || !f.title.trim() || !!dateProblem}>
            {saving && <Loader2 className="animate-spin" />}
            Save goal
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
