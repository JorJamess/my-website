"use client";

import { useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES, COLOR_LABELS } from "@/lib/colors";
import { SCHEDULE_WEEKDAY_NAMES } from "@/lib/habits";
import { localDateKey } from "@/lib/time";
import { EVENT_COLORS, type EventColor, type Habit, type HabitScheduleType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KindHint } from "./kind-hint";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Form = {
  title: string;
  description: string;
  color: EventColor;
  type: HabitScheduleType;
  weekdays: number[];
  interval: string;
  start: string;
};

function initial(h: Habit | null): Form {
  if (h)
    return {
      title: h.title,
      description: h.description ?? "",
      color: h.color,
      type: h.schedule_type,
      weekdays: h.weekdays ?? [],
      interval: String(h.interval_days ?? 2),
      start: h.start_date,
    };
  return { title: "", description: "", color: "blue", type: "daily", weekdays: [1, 2, 3, 4, 5], interval: "2", start: localDateKey() };
}

export function HabitDialog({ open, onOpenChange, habit }: { open: boolean; onOpenChange: (o: boolean) => void; habit: Habit | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && <HabitForm key={habit ? `${habit.id}:${habit.updated_at}` : "new"} habit={habit} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const TYPES: { id: HabitScheduleType; label: string }[] = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Certain days" },
  { id: "interval", label: "Every few days" },
];

function HabitForm({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const [f, setF] = useState<Form>(() => initial(habit));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const interval = Number(f.interval);
  const problem =
    !f.title.trim()
      ? "Give the habit a name"
      : f.type === "weekdays" && f.weekdays.length === 0
        ? "Pick at least one day"
        : f.type === "interval" && !(Number.isInteger(interval) && interval >= 2 && interval <= 365)
          ? "Enter a number of days from 2 to 365"
          : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      const payload = {
        title: f.title.trim(),
        description: f.description.trim() || null,
        color: f.color,
        schedule_type: f.type,
        weekdays: f.type === "weekdays" ? f.weekdays : null,
        interval_days: f.type === "interval" ? interval : null,
        start_date: f.start,
      };
      if (habit) await api.updateHabit(habit.id, payload);
      else await api.createHabit(payload);
      toast.success(habit ? "Habit updated" : "Habit added");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the habit");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!habit) return;
    setSaving(true);
    try {
      await api.updateHabit(habit.id, { archived: !habit.archived_at });
      toast.success(habit.archived_at ? "Habit restored" : "Habit archived. Its history is kept");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the habit");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!habit) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      await api.deleteHabit(habit.id);
      toast.success("Habit deleted");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the habit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{habit ? "Edit habit" : "New habit"}</DialogTitle>
        <DialogDescription>Streaks only count the days a habit is scheduled, so days off never break one.</DialogDescription>
      </DialogHeader>
      {!habit && <KindHint current="habit" />}

      <div className="space-y-2">
        <Label htmlFor="h-title">Name</Label>
        <Input id="h-title" autoFocus={!habit} placeholder="Read for 20 minutes" value={f.title} onChange={(e) => set("title", e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label>How often</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="How often">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={f.type === t.id}
              onClick={() => set("type", t.id)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] transition-colors",
                f.type === t.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {f.type === "weekdays" && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = f.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("weekdays", on ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d].sort())}
                  className={cn(
                    "h-8 min-w-11 rounded-full border px-3 text-[13px] transition-colors",
                    on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {SCHEDULE_WEEKDAY_NAMES[d]}
                </button>
              );
            })}
          </div>
        )}
        {f.type === "interval" && (
          <div className="flex items-center gap-2 pt-1 text-sm">
            <Label htmlFor="h-int" className="font-normal text-muted-foreground">
              Every
            </Label>
            <Input id="h-int" type="number" min={2} max={365} className="w-20" value={f.interval} onChange={(e) => set("interval", e.target.value)} />
            <span className="text-muted-foreground">days</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="h-start">Starts on</Label>
        <Input id="h-start" type="date" className="w-auto" value={f.start} onChange={(e) => set("start", e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="h-desc">Notes</Label>
        <Textarea id="h-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
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
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition",
                COLOR_CLASSES[c].dot,
                f.color === c && "ring-2 ring-foreground/60",
              )}
            >
              {f.color === c && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {problem && f.title.trim() && <p className="text-sm text-destructive">{problem}.</p>}

      <DialogFooter className="gap-2 sm:justify-between">
        {habit ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={archive} disabled={saving}>
              {habit.archived_at ? "Restore" : "Archive"}
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={saving}>
              <Trash2 />
              {confirmDelete ? "Click again to delete" : "Delete"}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !!problem}>
            {saving && <Loader2 className="animate-spin" />}
            Save habit
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
