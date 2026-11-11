import "server-only";
import { InputError, ctx } from "../core";
import { normalizeCode, randomPairingCode, randomToken, sha256Hex } from "@/lib/obsidian/crypto";

export type ObsidianDevice = {
  id: string;
  name: string;
  vault_name: string | null;
  status: "active" | "revoked";
  paused: boolean;
  sync_requested_at: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  bridge_version: string | null;
};

type DeviceRow = Omit<ObsidianDevice, "paused"> & { paused: number; token_hash: string };
const toDevice = (row: DeviceRow): ObsidianDevice => {
  const r: Partial<DeviceRow> = { ...row };
  delete r.token_hash; // never leaves the database layer
  return { ...(r as Omit<DeviceRow, "token_hash">), paused: !!row.paused };
};

const CODE_TTL_MS = 10 * 60_000;
/** The Bridge's heartbeat is only written this often, so polling every 15 s does not write to D1 every time. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;

/** The owner asks for a code to type into the Bridge. Valid 10 minutes, one use, stored hashed. */
export async function createPairingCode() {
  const { db } = await ctx();
  const now = Date.now();
  await db.prepare("DELETE FROM obsidian_pairing_codes WHERE expires_at < ?").bind(new Date(now - 86_400_000).toISOString()).run();
  const code = randomPairingCode();
  const expires = new Date(now + CODE_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO obsidian_pairing_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(normalizeCode(code)), new Date(now).toISOString(), expires)
    .run();
  return { code, expires_at: expires };
}

/** The Bridge trades a valid code for a device token. The token is shown once; only its hash is stored. */
export async function completePairing(input: { code: string; name: string; vault_name?: string; version?: string }) {
  const { db } = await ctx();
  const now = new Date().toISOString();
  const hash = await sha256Hex(normalizeCode(input.code));
  // claim the code first: used_at is set only if it is unused and unexpired
  const claimed = await db.prepare("UPDATE obsidian_pairing_codes SET used_at = ?1 WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1").bind(now, hash).run();
  if ((claimed.meta.changes ?? 0) === 0) throw new InputError("That pairing code is wrong, already used, or expired");
  const id = crypto.randomUUID();
  const token = randomToken(32);
  await db
    .prepare("INSERT INTO obsidian_devices (id, name, vault_name, token_hash, paired_at, last_seen_at, bridge_version) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.name.slice(0, 80), input.vault_name?.slice(0, 120) ?? null, await sha256Hex(token), now, now, input.version?.slice(0, 40) ?? null)
    .run();
  return { device_id: id, token };
}

/** Check a Bridge request's token. Returns the device, or null when unknown or revoked. */
export async function authenticateDevice(token: string | null | undefined): Promise<ObsidianDevice | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { db } = await ctx();
  const row = await db.prepare("SELECT * FROM obsidian_devices WHERE token_hash = ?").bind(await sha256Hex(token)).first<DeviceRow>();
  if (!row || row.status !== "active") return null;
  const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (Date.now() - seen > LAST_SEEN_EVERY_MS) {
    const now = new Date().toISOString();
    await db.prepare("UPDATE obsidian_devices SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
    row.last_seen_at = now;
  }
  return toDevice(row);
}

export async function listDevices(): Promise<ObsidianDevice[]> {
  const { db } = await ctx();
  const { results } = await db.prepare("SELECT * FROM obsidian_devices ORDER BY paired_at DESC").all<DeviceRow>();
  return results.map(toDevice);
}

export async function getDevice(id: string) {
  const { db } = await ctx();
  const r = await db.prepare("SELECT * FROM obsidian_devices WHERE id = ?").bind(id).first<DeviceRow>();
  return r ? toDevice(r) : null;
}

/** The token stops working at once; the Mac finds out on its next request. */
export async function revokeDevice(id: string) {
  const { db } = await ctx();
  const r = await db.prepare("UPDATE obsidian_devices SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'").bind(new Date().toISOString(), id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function setPaused(id: string, paused: boolean) {
  const { db } = await ctx();
  const r = await db.prepare("UPDATE obsidian_devices SET paused = ? WHERE id = ? AND status = 'active'").bind(paused ? 1 : 0, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function requestSync(id: string) {
  const { db } = await ctx();
  const r = await db.prepare("UPDATE obsidian_devices SET sync_requested_at = ? WHERE id = ? AND status = 'active'").bind(new Date().toISOString(), id).run();
  return (r.meta.changes ?? 0) > 0;
}

/** The Bridge reports it has seen the sync request. */
export async function clearSyncRequest(id: string) {
  const { db } = await ctx();
  await db.prepare("UPDATE obsidian_devices SET sync_requested_at = NULL WHERE id = ?").bind(id).run();
}
