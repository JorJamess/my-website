import "server-only";
import type { MoneyDay, MoneyRecurring, MoneySummary, MoneyTransaction } from "@/lib/money-types";
import { getEnv } from "./env";

/** แอปเงินไม่พร้อม (ยังไม่ตั้ง key, ยังไม่ deploy API, key ไม่ตรง ฯลฯ) */
export class MoneyUnavailableError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

async function moneyGet<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const env = await getEnv();
  const key = env.INTEGRATION_KEY;
  if (!key) throw new MoneyUnavailableError("ยังไม่ได้ตั้งค่า INTEGRATION_KEY");

  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const rel = `/api/integration/v1/${path}${qs.size ? `?${qs}` : ""}`;
  const init: RequestInit = { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } };

  let res: Response;
  try {
    // dev: ใช้ URL สาธารณะ / production: ใช้ service binding (ไม่ผ่านอินเทอร์เน็ต)
    if (env.MONEY_API_URL) res = await fetch(`${env.MONEY_API_URL.replace(/\/$/, "")}${rel}`, init);
    else if (env.MONEY) res = await env.MONEY.fetch(`https://money-tracker${rel}`, init);
    else throw new MoneyUnavailableError("ไม่มี service binding MONEY");
  } catch (err) {
    if (err instanceof MoneyUnavailableError) throw err;
    console.error("[money] fetch failed", err);
    throw new MoneyUnavailableError("เชื่อมต่อแอปเงินไม่ได้");
  }

  if (res.status === 401) throw new MoneyUnavailableError("กุญแจเชื่อมแอปเงินไม่ตรงกัน (INTEGRATION_KEY)");
  if (res.status === 404) throw new MoneyUnavailableError("แอปเงินยังไม่มี Integration API (ยังไม่ได้ deploy?)");
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new MoneyUnavailableError(body?.error ?? `แอปเงินตอบกลับผิดพลาด (${res.status})`);
  return body;
}

export async function getMoneySummary(month?: string) {
  if (month && !MONTH.test(month)) throw new MoneyUnavailableError("month ต้องเป็น YYYY-MM", 400);
  return moneyGet<MoneySummary>("summary", { month });
}

function checkRange(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new MoneyUnavailableError("from/to ต้องเป็น YYYY-MM-DD", 400);
}

/** ยอดรายวัน + บิลที่ถึงกำหนด ในช่วง from–to (inclusive) */
export async function getMoneyCalendar(from: string, to: string) {
  checkRange(from, to);
  const [daily, recurring] = await Promise.all([
    moneyGet<{ days: MoneyDay[] }>("daily", { from, to }),
    moneyGet<{ items: MoneyRecurring[] }>("recurring", { from, to }),
  ]);
  return { days: daily.days, recurring: recurring.items };
}

export async function getMoneyTransactions(from: string, to: string, limit = 50) {
  checkRange(from, to);
  const r = await moneyGet<{ transactions: MoneyTransaction[] }>("transactions", { from, to, limit: String(limit) });
  return r.transactions;
}
