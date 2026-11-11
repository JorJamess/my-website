/**
 * Ranked note search without a search index. Thai has no spaces between words, so a word-based full-text index
 * would match poorly; plain substring matching works for Thai and English alike, and a personal notebook is small.
 */
export type RankableNote = { title: string; content: string; tags: string[]; pinned: boolean; updated_at: string };

/** "database  normalization" -> ["database","normalization"] (lower-case, unique, at most 6 words) */
export function queryTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean))].slice(0, 6);
}

const countOf = (hay: string, needle: string) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1 && n < 20; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** Higher is better. Title hits count most, then tags, then how often the word appears in the text. */
export function scoreNote(n: RankableNote, terms: string[]): number {
  if (!terms.length) return 0;
  const title = n.title.toLowerCase();
  const content = n.content.toLowerCase();
  const tags = n.tags.map((t) => t.toLowerCase());
  let score = 0;
  let matched = 0;
  for (const t of terms) {
    const inTitle = title.includes(t);
    const inTag = tags.some((x) => x.includes(t));
    const inText = countOf(content, t);
    if (inTitle || inTag || inText) matched++;
    score += (inTitle ? 5 : 0) + (inTag ? 4 : 0) + Math.min(inText, 5);
  }
  if (matched === terms.length && terms.length > 1) score += 5; // every word is present
  if (n.pinned) score += 1;
  return score;
}

/** Rank notes best first; equal scores go to the most recently edited. Notes that match nothing are dropped. */
export function rankNotes<T extends RankableNote>(notes: T[], terms: string[]): { note: T; score: number }[] {
  return notes
    .map((note) => ({ note, score: scoreNote(note, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updated_at.localeCompare(a.note.updated_at));
}

/** A short piece of the text around the first word that matches, with Markdown marks stripped. */
export function snippetAround(text: string, terms: string[], len = 160): string {
  const flat = text.replace(/[#>*`\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  if (!hits.length || flat.length <= len) return flat.slice(0, len);
  const at = Math.min(...hits);
  const start = Math.max(0, at - 50);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + len)}${start + len < flat.length ? "…" : ""}`;
}
