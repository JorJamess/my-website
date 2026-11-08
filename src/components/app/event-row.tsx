"use client";

import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES } from "@/lib/colors";
import { eventTimeLabel } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

export function EventRow({
  event,
  onOpen,
  prefix,
}: {
  event: CalendarEvent;
  onOpen: (e: CalendarEvent) => void;
  prefix?: React.ReactNode;
}) {
  async function toggleDone(done: boolean) {
    try {
      await api.updateEvent(event.id, { done });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ");
    }
  }

  return (
    <div className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <Checkbox
        className="mt-0.5"
        checked={event.done}
        onCheckedChange={(v) => toggleDone(v === true)}
        aria-label={event.done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
      />
      <button type="button" onClick={() => onOpen(event)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <span className={cn("mt-1 h-3.5 w-1 shrink-0 rounded-full", COLOR_CLASSES[event.color].bar)} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", event.done && "text-muted-foreground line-through")}>
            {event.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {prefix}
            <span className="tabular-nums">{eventTimeLabel(event)}</span>
            {event.location && (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <MapPin className="size-3" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}
