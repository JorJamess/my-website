// เวลาทั้งหมดในระบบ (ทั้งเว็บและ MCP) อิงโซนเวลาคงที่นี้ — ประเทศไทย +07:00 ไม่มี DST
// ถ้าต้องการเปลี่ยนโซนเวลา แก้ที่นี่ที่เดียว
export const TZ_OFFSET = "+07:00";
const DEFAULT_TZ_OFFSET = TZ_OFFSET;

export function offsetMinutes(offset: string = DEFAULT_TZ_OFFSET): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return 420;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

/**
 * แปลงข้อความเวลาเป็น Date
 * - "2026-11-08"            → 00:00 ของวันนั้น (เวลาท้องถิ่น)
 * - "2026-11-08 14:30" / "2026-11-08T14:30" → เวลาท้องถิ่น
 * - มี Z หรือ +hh:mm อยู่แล้ว → ใช้ตามนั้น
 */
export function parseLocal(input: string, offset = DEFAULT_TZ_OFFSET): Date {
  const s = input.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00${offset}`);
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return new Date(s);
  const withSec = /T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
  return new Date(`${withSec}${offset}`);
}

export function isValidDate(d: Date) {
  return !Number.isNaN(d.getTime());
}

/** Date → "YYYY-MM-DDTHH:mm+07:00" ในโซนท้องถิ่น */
export function formatLocal(iso: string | Date, offset = DEFAULT_TZ_OFFSET): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const shifted = new Date(d.getTime() + offsetMinutes(offset) * 60_000);
  return `${shifted.toISOString().slice(0, 16)}${offset}`;
}

/** วันที่ท้องถิ่น "YYYY-MM-DD" ของ Date */
export function localDateKey(d: Date = new Date(), offset = DEFAULT_TZ_OFFSET): string {
  const shifted = new Date(d.getTime() + offsetMinutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------------- helpers สำหรับ UI (ไม่ขึ้นกับโซนเวลาของเบราว์เซอร์) ---------------- */

type EventTimes = { start_at: string; end_at: string | null; all_day: boolean };

/** วันที่เริ่มและวันสุดท้าย (inclusive) ของงาน เป็น "YYYY-MM-DD" */
export function eventDayRange(e: EventTimes): [string, string] {
  const start = localDateKey(new Date(e.start_at));
  if (!e.end_at) return [start, start];
  const endMs = new Date(e.end_at).getTime() - (e.all_day ? 1 : 0);
  const end = localDateKey(new Date(Math.max(endMs, new Date(e.start_at).getTime())));
  return [start, end];
}

export function eventOnDay(e: EventTimes, dayKey: string) {
  const [s, en] = eventDayRange(e);
  return s <= dayKey && dayKey <= en;
}

/** "14:30" */
export function timeOf(iso: string) {
  return formatLocal(iso).slice(11, 16);
}

/** ISO UTC → { date: "YYYY-MM-DD", time: "HH:mm" } ในโซนท้องถิ่น */
export function splitLocal(iso: string) {
  const f = formatLocal(iso);
  return { date: f.slice(0, 10), time: f.slice(11, 16) };
}

const keyToDate = (key: string) => new Date(`${key}T00:00:00Z`);

export function formatDay(key: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", ...opts }).format(keyToDate(key));
}

export function weekdayIndex(key: string) {
  return keyToDate(key).getUTCDay(); // 0 = อาทิตย์
}

/** label ของงาน เช่น "ทั้งวัน", "14:30–16:00" */
export function eventTimeLabel(e: EventTimes) {
  const [s, en] = eventDayRange(e);
  if (e.all_day) return s === en ? "ทั้งวัน" : `ทั้งวัน · ถึง ${formatDay(en, { day: "numeric", month: "short" })}`;
  const start = timeOf(e.start_at);
  if (!e.end_at) return start;
  const endDay = localDateKey(new Date(e.end_at));
  return endDay === s ? `${start}–${timeOf(e.end_at)}` : `${start} → ${formatDay(endDay, { day: "numeric", month: "short" })} ${timeOf(e.end_at)}`;
}
