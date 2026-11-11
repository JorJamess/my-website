// Backup schedule in the Mac's local time zone: daily 02:00, Sundays 02:00, the 1st of the month 02:00.
// Pure functions: given "now" and the snapshots that exist, which cycles still need a backup?

export type Label = "daily" | "weekly" | "monthly";
export const SCHEDULED: Label[] = ["daily", "weekly", "monthly"];
export const RETENTION: Record<Label | "safety" | "manual", number> = { daily: 7, weekly: 4, monthly: 3, safety: 10, manual: 5 };
export const BACKUP_HOUR = 2;

const at2 = (y: number, m: number, d: number) => new Date(y, m, d, BACKUP_HOUR, 0, 0, 0);
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The most recent scheduled time at or before `now`. */
export function lastOccurrence(now: Date, label: Label): Date {
  if (label === "daily") {
    const t = at2(now.getFullYear(), now.getMonth(), now.getDate());
    return t <= now ? t : at2(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  if (label === "weekly") {
    const t = at2(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    return t <= now ? t : at2(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
  }
  const t = at2(now.getFullYear(), now.getMonth(), 1);
  return t <= now ? t : at2(now.getFullYear(), now.getMonth() - 1, 1);
}

export const cycleKeys = (now: Date): Record<Label, string> => ({ daily: dayKey(lastOccurrence(now, "daily")), weekly: dayKey(lastOccurrence(now, "weekly")), monthly: dayKey(lastOccurrence(now, "monthly")) });

/**
 * Which scheduled cycles have no snapshot yet. One backup can satisfy several cycles at once (no duplicate copies),
 * and a Mac that was asleep or off simply makes the current cycles due: it runs once, not once per missed day.
 */
export function dueLabels(now: Date, snapshots: { cycles?: Partial<Record<Label, string>> }[]): Label[] {
  const keys = cycleKeys(now);
  return SCHEDULED.filter((l) => !snapshots.some((s) => s.cycles?.[l] === keys[l]));
}

/** Weekly and monthly (and the very first) snapshots are full independent copies; daily ones reuse unchanged files. */
export const modeFor = (labels: Label[], hasPrevious: boolean): "full" | "incremental" => (!hasPrevious || labels.includes("weekly") || labels.includes("monthly") ? "full" : "incremental");
