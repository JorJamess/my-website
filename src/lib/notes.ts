/** Tags are short, lower-case, and have no leading '#'. At most 8 per note. */
export const MAX_TAGS = 8;

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase().slice(0, 30);
}

export function normalizeTags(raw: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const r of raw ?? []) {
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
