// Minimal, format-preserving handling of a note's YAML frontmatter.
// We only ever read a few keys, and we only ever change one line at a time, so the rest of the file stays byte for byte.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedNote = {
  hasFrontmatter: boolean;
  /** the id exactly as written (may be invalid) */
  id: string | null;
  /** true only for the literal value `true` (unquoted) */
  sync: boolean;
  /** present but not the literal true/false, e.g. "yes" or "true" in quotes */
  syncRaw: string | null;
  tags: string[];
  body: string;
};

const FM_RE = /^(?:﻿)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

function unquote(v: string) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) return { value: t.slice(1, -1), quoted: true };
  return { value: t.replace(/\s+#.*$/, ""), quoted: false };
}

function parseTags(lines: string[], i: number, inline: string): string[] {
  const raw = inline.trim();
  if (raw.startsWith("[")) {
    return raw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((t) => unquote(t).value.replace(/^#/, "").trim())
      .filter(Boolean);
  }
  if (raw) {
    return raw
      .split(/[,\s]+/)
      .map((t) => unquote(t).value.replace(/^#/, ""))
      .filter(Boolean);
  }
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = /^\s+-\s*(.+?)\s*$/.exec(lines[j]);
    if (!m) break;
    out.push(unquote(m[1]).value.replace(/^#/, ""));
  }
  return out;
}

export function parseNote(text: string): ParsedNote {
  const m = FM_RE.exec(text);
  const result: ParsedNote = { hasFrontmatter: !!m, id: null, sync: false, syncRaw: null, tags: [], body: m ? text.slice(m[0].length) : text };
  if (!m) return result;
  const lines = m[1].split(/\r?\n/);
  lines.forEach((line, i) => {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) return;
    const [, key, rest] = kv;
    if (key === "id") {
      const v = unquote(rest).value;
      result.id = v === "" ? null : v;
    } else if (key === "lifeos_sync") {
      const { value, quoted } = unquote(rest);
      result.syncRaw = value;
      result.sync = !quoted && /^true$/i.test(value);
    } else if (key === "tags" || key === "tag") {
      result.tags.push(...parseTags(lines, i, rest));
    }
  });
  result.tags = [...new Set(result.tags)].slice(0, 50);
  return result;
}

/** Set (or add) one top-level key. Only that line changes; line endings and everything else stay as they were. */
export function setFrontmatterKey(text: string, key: string, value: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const m = FM_RE.exec(text);
  if (!m) return `---${eol}${key}: ${value}${eol}---${eol}${text}`;
  const openLen = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(m[0])![0].length;
  const blockEnd = openLen + m[1].length;
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (idx >= 0) lines[idx] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return m[0].slice(0, openLen) + lines.join(eol) + m[0].slice(blockEnd) + text.slice(m[0].length);
}

/** Replace the body (everything after the frontmatter) and keep the frontmatter untouched. */
export function replaceBody(text: string, newBody: string): string {
  const m = FM_RE.exec(text);
  return m ? text.slice(0, m[0].length) + newBody : newBody;
}
