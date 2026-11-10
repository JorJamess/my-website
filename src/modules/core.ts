import "server-only";
import { isValidDate, localDateKey, parseLocal, addDaysKey, TZ_OFFSET } from "@/lib/time";
import { getEnv } from "@/lib/server/env";

export class InputError extends Error {}

export async function ctx() {
  const env = await getEnv();
  return { db: env.DB, tz: TZ_OFFSET };
}

export function parseOrThrow(value: string, tz: string, field: string) {
  const d = parseLocal(value, tz);
  if (!isValidDate(d)) throw new InputError(`Invalid date or time for ${field}: "${value}"`);
  return d;
}

/** คำนวณ start/end (UTC ISO) จาก input; งานทั้งวัน end เป็นแบบ exclusive (00:00 ของวันถัดไป) */
export function resolveTimes(
  start: string,
  end: string | null | undefined,
  allDay: boolean,
  tz: string,
): { start_at: string; end_at: string | null } {
  if (allDay) {
    const startKey = localDateKey(parseOrThrow(start, tz, "start"), tz);
    const lastKey = end ? localDateKey(parseOrThrow(end, tz, "end"), tz) : startKey;
    const endKey = addDaysKey(lastKey < startKey ? startKey : lastKey, 1);
    return {
      start_at: parseLocal(startKey, tz).toISOString(),
      end_at: parseLocal(endKey, tz).toISOString(),
    };
  }
  const s = parseOrThrow(start, tz, "start");
  const e = end ? parseOrThrow(end, tz, "end") : null;
  if (e && e < s) throw new InputError("End time can't be before the start time");
  return { start_at: s.toISOString(), end_at: e ? e.toISOString() : null };
}

