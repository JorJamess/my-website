"use client";

import { useState } from "react";
import { Check, Loader2, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES, COLOR_LABELS } from "@/lib/colors";
import { eventDayRange, localDateKey, splitLocal, TZ_OFFSET } from "@/lib/time";
import { EVENT_COLORS, type CalendarEvent, type EventColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormState = {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  color: EventColor;
  done: boolean;
};

function initialState(event: CalendarEvent | null, defaultDate?: string): FormState {
  if (event) {
    const s = splitLocal(event.start_at);
    const [, lastDay] = eventDayRange(event);
    const e = event.end_at ? splitLocal(event.end_at) : null;
    return {
      title: event.title,
      allDay: event.all_day,
      startDate: s.date,
      startTime: event.all_day ? "09:00" : s.time,
      endDate: event.all_day ? lastDay : (e?.date ?? s.date),
      endTime: event.all_day ? "10:00" : (e?.time ?? ""),
      location: event.location ?? "",
      description: event.description ?? "",
      color: event.color,
      done: event.done,
    };
  }
  const date = defaultDate ?? localDateKey();
  return {
    title: "",
    allDay: false,
    startDate: date,
    startTime: "09:00",
    endDate: date,
    endTime: "10:00",
    location: "",
    description: "",
    color: "blue",
    done: false,
  };
}

export function EventDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  defaultDate?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <EventForm
            key={event ? `${event.id}:${event.updated_at}` : `new:${defaultDate}`}
            event={event}
            defaultDate={defaultDate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  event,
  defaultDate,
  onClose,
}: {
  event: CalendarEvent | null;
  defaultDate?: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(event, defaultDate));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const start = form.allDay ? form.startDate : `${form.startDate}T${form.startTime}${TZ_OFFSET}`;
    let end: string | null = null;
    if (form.allDay) end = form.endDate && form.endDate > form.startDate ? form.endDate : null;
    else if (form.endTime) end = `${form.endDate || form.startDate}T${form.endTime}${TZ_OFFSET}`;

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        start,
        all_day: form.allDay,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        color: form.color,
      };
      if (event) {
        await api.updateEvent(event.id, { ...payload, end, done: form.done });
        toast.success("Event updated");
      } else {
        await api.createEvent({
          ...payload,
          end: end ?? undefined,
          location: payload.location ?? undefined,
          description: payload.description ?? undefined,
        });
        toast.success("Event added");
      }
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the event");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      toast.success("Event deleted");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the event");
    } finally {
      setSaving(false);
    }
  }

  return (
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>All times are Thailand time (UTC{TZ_OFFSET}).</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="ev-title">Title</Label>
            <Input
              id="ev-title"
              autoFocus={!event}
              placeholder="Team meeting"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
            />
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={form.allDay} onCheckedChange={(v) => set("allDay", v === true)} />
            All day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ev-sd">Starts</Label>
              <Input
                id="ev-sd"
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, startDate: v, endDate: f.endDate < v ? v : f.endDate }));
                }}
                required
              />
            </div>
            {!form.allDay && (
              <div className="space-y-2">
                <Label htmlFor="ev-st">Time</Label>
                <Input id="ev-st" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} required />
              </div>
            )}
            <div className={cn("space-y-2", form.allDay && "col-start-1")}>
              <Label htmlFor="ev-ed">{form.allDay ? "Until" : "Ends"}</Label>
              <Input
                id="ev-ed"
                type="date"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </div>
            {!form.allDay && (
              <div className="space-y-2">
                <Label htmlFor="ev-et">Time</Label>
                <Input id="ev-et" type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ev-loc">Location</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="ev-loc" className="pl-8" value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ev-desc">Details</Label>
            <Textarea id="ev-desc" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
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
                  aria-pressed={form.color === c}
                  onClick={() => set("color", c)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition",
                    COLOR_CLASSES[c].dot,
                    form.color === c && "ring-2 ring-foreground/60",
                  )}
                >
                  {form.color === c && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
          </div>

          {event && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={form.done} onCheckedChange={(v) => set("done", v === true)} />
              Done
            </label>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {event ? (
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
              <Button type="submit" disabled={saving || !form.title.trim()}>
                {saving && <Loader2 className="animate-spin" />}
                Save event
              </Button>
            </div>
          </DialogFooter>
        </form>
  );
}

