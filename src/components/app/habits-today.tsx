"use client";

import Link from "next/link";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { COLOR_CLASSES } from "@/lib/colors";
import { localDateKey } from "@/lib/time";
import type { HabitToday } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

/** The habits scheduled today, tickable straight from the Today page. */
export function HabitsToday({ habits }: { habits: HabitToday[] }) {
  const done = habits.filter((h) => h.done).length;

  async function tick(h: HabitToday, value: boolean) {
    try {
      await api.checkin(h.id, { day: localDateKey(), done: value });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the check-in");
    }
  }

  return (
    <div>
      <h2 className="mb-3.5 flex items-center text-[13px] font-medium text-muted-foreground">
        Habits <span className="ml-1.5 tabular-nums">· {done} of {habits.length}</span>
        <Link href="/app/habits" className="ml-auto font-normal hover:text-brand">
          See all
        </Link>
      </h2>
      <ul>
        {habits.map((h) => (
          <li key={h.id} className="flex items-center gap-3 border-t py-2.5">
            <Checkbox
              checked={h.done}
              onCheckedChange={(v) => tick(h, v === true)}
              aria-label={h.done ? `Undo ${h.title} for today` : `Mark ${h.title} done today`}
            />
            <span className={cn("size-2 shrink-0 rounded-full", COLOR_CLASSES[h.color].dot)} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[15px]">
              <span className="strike-line" data-done={h.done}>
                {h.title}
              </span>
            </span>
            {h.current_streak > 0 && <span className="text-[12px] text-muted-foreground tabular-nums">{h.current_streak} in a row</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
