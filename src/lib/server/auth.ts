import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "./env";

export const SESSION_COOKIE = "mw_session";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** เปรียบเทียบสตริงแบบเวลาคงที่ (กัน timing attack) */
export function safeEqual(a: string, b: string) {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken() {
  const env = await getEnv();
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `admin.${exp}`;
  return { token: `${payload}.${await hmac(env.SESSION_SECRET, payload)}`, maxAge: SESSION_DAYS * 86_400 };
}

async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const env = await getEnv();
  if (!env.SESSION_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, `${who}.${exp}`));
}

export async function isAuthed() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function checkPassword(password: string) {
  const env = await getEnv();
  if (!env.ADMIN_PASSWORD) return false;
  return safeEqual(password, env.ADMIN_PASSWORD);
}

export async function checkMcpToken(token: string | null | undefined) {
  if (!token) return false;
  const env = await getEnv();
  if (!env.MCP_TOKEN || env.MCP_TOKEN.length < 16) return false;
  return safeEqual(token, env.MCP_TOKEN);
}
