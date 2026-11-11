/** Small line diff for showing the owner what an edit would change. Not a general-purpose differ. */
export function lineDiff(a: string, b: string, context = 3, maxChars = 200_000): string {
  const A = a.split("\n");
  const B = b.split("\n");
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const ops: string[] = [];
  if (midA.length * midB.length <= 4_000_000) {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) ops.push(` ${midA[i++]}`), j++;
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(`-${midA[i++]}`);
      else ops.push(`+${midB[j++]}`);
    }
    while (i < n) ops.push(`-${midA[i++]}`);
    while (j < m) ops.push(`+${midB[j++]}`);
  } else {
    for (const l of midA) ops.push(`-${l}`);
    for (const l of midB) ops.push(`+${l}`);
  }
  const before = A.slice(Math.max(0, start - context), start).map((l) => ` ${l}`);
  const after = A.slice(endA, endA + context).map((l) => ` ${l}`);
  const out = [`@@ line ${start + 1} @@`, ...before, ...ops, ...after].join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n… (diff cut)` : out;
}
