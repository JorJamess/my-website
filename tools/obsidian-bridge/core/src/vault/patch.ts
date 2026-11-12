import { renderForUpload } from "./links.js";

type Op = { t: "eq" | "del" | "add"; i?: number; j?: number };

/** Line diff of two arrays. Returns null when the changed middle is too big to compare safely. */
function diffLines(a: string[], b: string[]): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > 4_000_000) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[start + i] === b[start + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const ops: Op[] = [];
  for (let k = 0; k < start; k++) ops.push({ t: "eq", i: k, j: k });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) ops.push({ t: "eq", i: start + i++, j: start + j++ });
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: "del", i: start + i++ });
    else ops.push({ t: "add", j: start + j++ });
  }
  while (i < n) ops.push({ t: "del", i: start + i++ });
  while (j < m) ops.push({ t: "add", j: start + j++ });
  for (let k = 0; k < a.length - endA; k++) ops.push({ t: "eq", i: endA + k, j: endB + k });
  return ops;
}

/**
 * Apply the text Claude proposed to the real note body. Claude saw the synced view (images replaced by placeholders),
 * and the view has exactly one line per line of the note, so the change can be applied line by line: lines Claude did
 * not touch keep their original text (embedded images included), and a placeholder Claude kept in a line it changed is
 * turned back into the original embed. Returns null if the change is too large to apply safely.
 */
export function patchBody(body: string, proposed: string): string | null {
  const crlf = body.includes("\r\n");
  const original = body.split("\n");
  const pairs = new Map<string, string>();
  const view = renderForUpload(body, (ph, orig) => {
    if (!pairs.has(ph)) pairs.set(ph, orig);
  }).split("\n");
  if (view.length !== original.length) return null;
  // an embed written over several lines cannot be put back line by line: refuse rather than guess
  if ([...pairs.values()].some((o) => o.includes("\n"))) return null;
  if (!view.join("\n").trim()) return proposed;
  const next = proposed.replace(/\r\n/g, "\n").split("\n");
  const ops = diffLines(view.map((l) => l.replace(/\r$/, "")), next);
  if (!ops) return null;
  const out: string[] = [];
  for (const op of ops) {
    if (op.t === "eq") out.push(original[op.i!]);
    else if (op.t === "add") {
      let line = next[op.j!];
      for (const [ph, orig] of pairs) if (line.includes(ph)) line = line.split(ph).join(orig);
      out.push(crlf && op.j! < next.length - 1 ? `${line}\r` : line);
    }
  }
  return out.join("\n");
}
