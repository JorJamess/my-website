// Secret scanner. Pure TypeScript with no framework imports, so the Mac Bridge can reuse it.
// It is a safety net, not a guarantee: it cannot recognise every password or secret.

export type Finding = {
  kind: string;
  line: number;
  /** a masked preview such as sk-a••••, never the full value */
  redacted: string;
  /** stable identifier for this exact finding in this exact text (used for per-finding exceptions) */
  fingerprint: string;
};

type Rule = { kind: string; re: RegExp; group?: number };

const RULES: Rule[] = [
  { kind: "private_key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { kind: "github_token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { kind: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe_key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "api_key", re: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: "bearer_token", re: /\bBearer\s+([A-Za-z0-9._~+/-]{24,}=*)/g, group: 1 },
  { kind: "url_credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{4,})@/gi, group: 1 },
  // password = "something", api_key: abc123..., secret=...
  {
    kind: "password_assignment",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token)\b["']?\s*[:=]\s*["']?([^\s"'`,;]{6,})/gi,
    group: 1,
  },
];

/** things that look like secrets but are placeholders in documentation */
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|•+|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_]+\}?|your[-_ ]?.*|example.*|changeme|password|secret|token|null|none|true|false|undefined|process\.env.*|env\..*|[a-z_]+\(\))$/i;

function mask(v: string) {
  return `${v.slice(0, 4)}••••`;
}

function entropy(s: string) {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Find potential secrets. Returns type and position only; the full value is never returned. */
export function scanForSecrets(text: string): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const covered: [number, number][] = [];
  const occurrences = new Map<string, number>();
  const lines = text.split("\n");
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const add = (kind: string, value: string, index: number) => {
    // one secret matched by two rules is reported once (the more specific rule runs first)
    if (covered.some(([a, b]) => index < b && index + value.length > a)) return;
    covered.push([index, index + value.length]);
    const line = lineOf(index);
    const key = `${kind}:${line}:${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    // The fingerprint names this value (not its line, which differs between the whole note and an uploaded chunk) and
    // which occurrence of it this is; it cannot be reversed into the value in any useful way.
    const id = `${kind}:${fnv(value)}${fnv(value.split("").reverse().join(""))}`;
    const n = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, n);
    found.push({ kind, line, redacted: mask(value), fingerprint: `${id}:${n}` });
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const value = (rule.group ? m[rule.group] : m[0])?.replace(/[.)\]]+$/, "");
      if (!value || PLACEHOLDER.test(value)) continue;
      if (rule.kind === "password_assignment" && value.length < 8 && !/\d/.test(value)) continue;
      add(rule.kind, value, m.index ?? 0);
    }
  }

  // high-entropy tokens that no rule matched (long random-looking strings)
  let offset = 0;
  for (const l of lines) {
    for (const m of l.matchAll(/[A-Za-z0-9+/_-]{32,}={0,2}/g)) {
      const v = m[0];
      if (PLACEHOLDER.test(v) || /^[a-z]+$/i.test(v)) continue;
      if (entropy(v) >= 4.3 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) add("high_entropy", v, offset + (m.index ?? 0));
    }
    offset += l.length + 1;
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Drop findings the owner approved. An exception only counts if it was made for exactly this content. */
export function withoutExceptions(findings: Finding[], exceptions: { fingerprint: string; contentHash: string }[], currentHash: string): Finding[] {
  const ok = new Set(exceptions.filter((e) => e.contentHash === currentHash).map((e) => e.fingerprint));
  return findings.filter((f) => !ok.has(f.fingerprint));
}
