"use client";

import { useState } from "react";
import { Check, Loader2, MapPin, Trash2 } from "lucide-react";
import { WEEKDAY_SHORT } from "@/lib/recurrence";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES } from "@/lib/colors";
import { useColorNames } from "@/lib/client/use-color-names";
import { eventDayRange, localDateKey, splitLocal, TZ_OFFSET, weekdayIndex } from "@/lib/time";
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
  repeatDays: number[];
  repeatUntil: string;
};

/** An occurrence on screen edits its whole series, so show the series' first occurrence. */
function seriesStart(event: CalendarEvent): CalendarEvent {
  if (!event.series_start_at) return event;
  const shift = new Date(event.series_start_at).getTime() - new Date(event.start_at).getTime();
  return {
    ...event,
    start_at: event.series_start_at,
    end_at: event.end_at ? new Date(new Date(event.end_at).getTime() + shift).toISOString() : null,
  };
}

function initialState(occurrence: CalendarEvent | null, defaultDate?: string, defaultTime?: string, justThisOne = false): FormState {
  // a single occurrence shows its own date and time; the whole series shows when it first starts
  const event = occurrence && (justThisOne ? occurrence : seriesStart(occurrence));
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
      repeatDays: justThisOne ? [] : (event.repeat_days ?? []),
      repeatUntil: justThisOne ? "" : (event.repeat_until ?? ""),
    };
  }
  const date = defaultDate ?? localDateKey();
  return {
    title: "",
    allDay: false,
    startDate: date,
    startTime: defaultTime ?? "09:00",
    endDate: date,
    endTime: defaultTime ? plusHour(defaultTime) : "10:00",
    location: "",
    description: "",
    color: "blue",
    done: false,
    repeatDays: [],
    repeatUntil: "",
  };
}

const plusHour = (t: string) => {
  const h = Number(t.slice(0, 2)) + 1;
  return h >= 24 ? "23:59" : `${String(h).padStart(2, "0")}${t.slice(2)}`;
};

export function EventDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
  defaultTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  defaultDate?: string;
  /** "HH:mm" for a new event created by clicking a time slot */
  defaultTime?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <EventForm
            key={event ? `${event.id}:${event.updated_at}` : `new:${defaultDate}:${defaultTime}`}
            event={event}
            defaultDate={defaultDate}
            defaultTime={defaultTime}
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
  defaultTime,
  onClose,
}: {
  event: CalendarEvent | null;
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
}) {
  const colorNames = useColorNames();
  // opening one day of a repeating event: change just that day, or the whole series
  const isOccurrence = !!event?.repeat_days && !!event.series_start_at;
  const [scope, setScope] = useState<"one" | "all">(isOccurrence ? "one" : "all");
  const [form, setForm] = useState<FormState>(() => initialState(event, defaultDate, defaultTime, isOccurrence));
  const occurrenceDay = event ? splitLocal(event.start_at).date : "";
  const justThisOne = isOccurrence && scope === "one";
  const changeScope = (next: "one" | "all") => {
    setScope(next);
    setConfirmDelete(false);
    setForm(initialState(event, defaultDate, defaultTime, next === "one"));
  };
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
      const repeat = form.repeatDays.length
        ? { repeat_days: form.repeatDays, repeat_until: form.repeatUntil || null }
        : { repeat_days: null, repeat_until: null };
      if (event && justThisOne) {
        // this day leaves the series and becomes its own event
        const created = await api.editOccurrence(event.id, occurrenceDay, {
          title: payload.title,
          start: payload.start,
          end: end ?? undefined,
          all_day: payload.all_day,
          location: payload.location ?? undefined,
          description: payload.description ?? undefined,
          color: payload.color,
        });
        if (form.done) await api.updateEvent(created.id, { done: true });
        toast.success("Changed just this one");
      } else if (event) {
        await api.updateEvent(event.id, { ...payload, ...repeat, end, done: form.done });
        toast.success(isOccurrence ? "Series updated" : "Event updated");
      } else {
        await api.createEvent({
          ...payload,
          end: end ?? undefined,
          location: payload.location ?? undefined,
          description: payload.description ?? undefined,
          ...(form.repeatDays.length
            ? { repeat_days: form.repeatDays, repeat_until: form.repeatUntil || undefined }
            : {}),
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
      if (justThisOne) {
        await api.skipOccurrence(event.id, occurrenceDay);
        toast.success("Removed from the series");
      } else {
        await api.deleteEvent(event.id);
        toast.success(isOccurrence ? "Series deleted" : "Event deleted");
      }
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
            <DialogTitle>{event ? (event.repeat_days ? "Edit repeating event" : "Edit event") : "New event"}</DialogTitle>
            <DialogDescription>
              All times are Thailand time (UTC{TZ_OFFSET}).
              {isOccurrence
                ? justThisOne
                  ? " Only this day changes. The rest of the series stays as it is."
                  : " Changes apply to every repeat."
                : event?.repeat_days
                  ? " Changes apply to every repeat."
                  : ""}
            </DialogDescription>
          </DialogHeader>

          {isOccurrence && (
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="What to change">
              {(
                [
                  { id: "one", label: "This event only" },
                  { id: "all", label: "All events in the series" },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={scope === o.id}
                  onClick={() => changeScope(o.id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[13.5px] transition-colors",
                    scope === o.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

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
                  title={colorNames[c]}
                  aria-label={colorNames[c]}
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

          {!justThisOne && (
          <div className="space-y-2">
            <Label>Repeat weekly</Label>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = form.repeatDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setForm((f) => {
                        let days = on ? f.repeatDays.filter((x) => x !== d) : [...f.repeatDays, d];
                        // first time: include the start day too
                        if (!on && f.repeatDays.length === 0) days = [...new Set([...days, weekdayIndex(f.startDate)])];
                        return { ...f, repeatDays: days.sort() };
                      })
                    }
                    className={cn(
                      "h-8 min-w-11 rounded-full border px-3 text-[13px] transition-colors",
                      on ? "border-brand bg-brand text-white" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                );
              })}
            </div>
            {form.repeatDays.length > 0 && (
              <div className="flex items-center gap-2 pt-1 text-sm">
                <Label htmlFor="ev-ru" className="font-normal text-muted-foreground">
                  Until
                </Label>
                <Input
                  id="ev-ru"
                  type="date"
                  min={form.startDate}
                  value={form.repeatUntil}
                  onChange={(e) => set("repeatUntil", e.target.value)}
                  className="w-auto"
                />
                <span className="text-xs text-muted-foreground">leave empty to repeat forever</span>
              </div>
            )}
          </div>
          )}

          {event && (form.repeatDays.length === 0 || justThisOne) && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={form.done} onCheckedChange={(v) => set("done", v === true)} />
              Done
            </label>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {event ? (
              <Button type="button" variant="destructive" onClick={remove} disabled={saving}>
                <Trash2 />
                {confirmDelete ? "Click again to delete" : isOccurrence ? (justThisOne ? "Delete this event" : "Delete series") : "Delete"}
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
                {isOccurrence ? (justThisOne ? "Save this event" : "Save series") : "Save event"}
              </Button>
            </div>
          </DialogFooter>
        </form>
  );
}

