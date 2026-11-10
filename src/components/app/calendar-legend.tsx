"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES, COLOR_LABELS } from "@/lib/colors";
import { EVENT_COLORS, type EventColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type CalendarFilter = { hidden: EventColor[]; tasks: boolean; milestones: boolean };

/** Colour legend that doubles as the filter: tap a chip to hide or show that colour. */
export function CalendarLegend({
  names,
  used,
  filter,
  onChange,
}: {
  names: Record<EventColor, string>;
  /** colours that appear in the visible range, so unused ones don't clutter the row */
  used: Set<EventColor>;
  filter: CalendarFilter;
  onChange: (f: CalendarFilter) => void;
}) {
  const [editing, setEditing] = useState(false);
  const toggle = (c: EventColor) => onChange({ ...filter, hidden: filter.hidden.includes(c) ? filter.hidden.filter((x) => x !== c) : [...filter.hidden, c] });
  const colors = EVENT_COLORS.filter((c) => used.has(c) || filter.hidden.includes(c));

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show or hide by colour">
      {colors.map((c) => {
        const off = filter.hidden.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={!off}
            onClick={() => toggle(c)}
            className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[12.5px] transition-opacity", off && "opacity-45")}
          >
            <span className={cn("size-2 rounded-full", COLOR_CLASSES[c].dot)} aria-hidden />
            <span className={cn(off && "line-through")}>{names[c]}</span>
          </button>
        );
      })}
      {(
        [
          { key: "tasks", label: "Tasks" },
          { key: "milestones", label: "◆ Milestones" },
        ] as const
      ).map(({ key, label }) => (
        <button
          key={key}
          type="button"
          aria-pressed={filter[key]}
          onClick={() => onChange({ ...filter, [key]: !filter[key] })}
          className={cn("rounded-full border border-dashed bg-card px-2.5 py-1 text-[12.5px] transition-opacity", !filter[key] && "opacity-45 line-through")}
        >
          {label}
        </button>
      ))}
      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Rename colours" title="Rename colours">
        <Pencil />
      </Button>
      <ColorNamesDialog open={editing} onOpenChange={setEditing} names={names} />
    </div>
  );
}

function ColorNamesDialog({ open, onOpenChange, names }: { open: boolean; onOpenChange: (o: boolean) => void; names: Record<EventColor, string> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">{open && <NamesForm names={names} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function NamesForm({ names, onClose }: { names: Record<EventColor, string>; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<EventColor, string>>({ ...names });
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.setColorNames(draft);
      toast.success("Colour names saved");
      notifyChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the names");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Name your colours</DialogTitle>
        <DialogDescription>Give each colour a meaning, like Study or Health. These names show in the legend and when you pick a colour.</DialogDescription>
      </DialogHeader>
      <ul className="space-y-2">
        {EVENT_COLORS.map((c) => (
          <li key={c} className="flex items-center gap-3">
            <span className={cn("size-3 shrink-0 rounded-full", COLOR_CLASSES[c].dot)} aria-hidden />
            <Input aria-label={`Name for ${COLOR_LABELS[c]}`} maxLength={24} value={draft[c]} placeholder={COLOR_LABELS[c]} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))} />
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          Save names
        </Button>
      </DialogFooter>
    </form>
  );
}
