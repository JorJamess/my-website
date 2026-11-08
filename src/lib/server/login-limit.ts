import "server-only";
import { getEnv } from "./env";

/** ผิดได้ MAX_FAILS ครั้งภายใน WINDOW_MS แล้วล็อก IP นั้นไว้ LOCK_MS */
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

type Row = { ip: string; fails: number; first_at: number; locked_until: number };

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

/** ถ้าถูกล็อกอยู่ คืนจำนวนวินาทีที่ต้องรอ ไม่งั้นคืน 0 */
export async function lockedFor(ip: string): Promise<number> {
  const { DB } = await getEnv();
  const row = await DB.prepare("SELECT * FROM login_attempts WHERE ip = ?").bind(ip).first<Row>();
  const wait = row ? row.locked_until - Date.now() : 0;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/** บันทึกการใส่ผิด คืนจำนวนวินาทีที่ถูกล็อก (0 ถ้ายังไม่ถึงเกณฑ์) */
export async function recordFailure(ip: string): Promise<number> {
  const { DB } = await getEnv();
  const now = Date.now();
  const row = await DB.prepare("SELECT * FROM login_attempts WHERE ip = ?").bind(ip).first<Row>();
  const inWindow = row && now - row.first_at < WINDOW_MS;
  const fails = inWindow ? row.fails + 1 : 1;
  const firstAt = inWindow ? row.first_at : now;
  const lockedUntil = fails >= MAX_FAILS ? now + LOCK_MS : 0;
  await DB.prepare(
    `INSERT INTO login_attempts (ip, fails, first_at, locked_until) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(ip) DO UPDATE SET fails = ?2, first_at = ?3, locked_until = ?4`,
  )
    .bind(ip, lockedUntil ? 0 : fails, lockedUntil ? now : firstAt, lockedUntil)
    .run();
  // ลบแถวเก่าที่หมดอายุแล้วไปด้วย (เก็บตารางให้เล็ก)
  await DB.prepare("DELETE FROM login_attempts WHERE locked_until < ?1 AND first_at < ?2")
    .bind(now, now - WINDOW_MS)
    .run();
  return lockedUntil ? Math.ceil(LOCK_MS / 1000) : 0;
}

export async function clearFailures(ip: string) {
  const { DB } = await getEnv();
  await DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export function waitMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
