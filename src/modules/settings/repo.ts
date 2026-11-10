import "server-only";
import { COLOR_LABELS } from "@/lib/colors";
import { EVENT_COLORS, type EventColor } from "@/lib/types";
import { ctx } from "../core";

const KEY = "color_names";

/** The name for each calendar colour (a "category"): the defaults, with the owner's own names on top. */
export async function getColorNames(): Promise<Record<EventColor, string>> {
  const { db } = await ctx();
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  let saved: Record<string, unknown> = {};
  try {
    saved = row ? (JSON.parse(row.value) as Record<string, unknown>) : {};
  } catch {
    saved = {};
  }
  return Object.fromEntries(
    EVENT_COLORS.map((c) => [c, typeof saved[c] === "string" && (saved[c] as string).trim() ? (saved[c] as string).trim().slice(0, 24) : COLOR_LABELS[c]]),
  ) as Record<EventColor, string>;
}

/** Rename some colours. Empty names go back to the default. Returns all names. */
export async function setColorNames(names: Partial<Record<EventColor, string>>): Promise<Record<EventColor, string>> {
  const { db } = await ctx();
  const current = await getColorNames();
  const next: Record<string, string> = { ...current };
  for (const c of EVENT_COLORS) {
    const v = names[c];
    if (v === undefined) continue;
    const clean = v.trim().slice(0, 24);
    next[c] = clean || COLOR_LABELS[c];
  }
  await db
    .prepare("INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2")
    .bind(KEY, JSON.stringify(next))
    .run();
  return next as Record<EventColor, string>;
}
