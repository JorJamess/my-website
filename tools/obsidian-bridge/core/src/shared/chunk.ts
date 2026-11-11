// Splits text into bounded chunks for D1 (rows must stay far below the 2 MB limit and searches return short excerpts).

export const CHUNK_CHARS = 4000;
export const MAX_CHUNKS_PER_REQUEST = 50;

/** Normalise Unicode the same way for storage and search. Keeps the original wording. */
export const normalizeText = (s: string) => s.normalize("NFC");

export type ChunkInput = { page?: number | null; heading?: string | null; content: string };

/** Split on paragraph boundaries where possible, hard-split very long paragraphs. */
export function chunkText(text: string, max = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur);
    cur = "";
  };
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > max) {
      push();
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + para.length + 2 > max) push();
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  push();
  return out;
}
