// Finds what a note points at: PDFs to extract and attachments to replace with a placeholder. Pure functions.

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "avif", "tif", "tiff"]);
const ATTACHMENT_EXT = new Set(["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mov", "webm", "mkv", "zip", "docx", "pptx", "xlsx", "csv", "excalidraw", "canvas"]);

export type PdfRef = { target: string; style: "wiki" | "embed" | "markdown" };

const extOf = (name: string) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
};
export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Blank out fenced and inline code so links inside code are not treated as references. */
function stripCode(text: string) {
  return text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length)).replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

const WIKI = /(!?)\[\[([^\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;

function cleanMdTarget(raw: string) {
  let t = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  t = t.replace(/#.*$/, "");
  try {
    t = decodeURIComponent(t);
  } catch {}
  return t;
}
const isExternal = (t: string) => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");

/** PDF references in Markdown: ![[x.pdf]], [[x.pdf]], [text](./x.pdf). Each target once, in order. */
export function findPdfRefs(markdown: string): PdfRef[] {
  const text = stripCode(markdown);
  const seen = new Set<string>();
  const out: PdfRef[] = [];
  const add = (target: string, style: PdfRef["style"]) => {
    const key = `${style}:${target}`;
    if (!target || seen.has(key) || extOf(target) !== "pdf") return;
    seen.add(key);
    out.push({ target: target.trim(), style });
  };
  for (const m of text.matchAll(WIKI)) add(m[2], m[1] ? "embed" : "wiki");
  for (const m of text.matchAll(MDLINK)) {
    const t = cleanMdTarget(m[2]);
    if (!isExternal(t)) add(t, "markdown");
  }
  return out;
}

/** Split into code (fenced or inline) and everything else; only the latter is ever rewritten. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
function mapOutsideCode(text: string, fn: (s: string) => string) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  return out + fn(text.slice(last));
}

/**
 * The text that is sent to the cloud: images and other attachments become placeholders (the files themselves never
 * leave the Mac). Links to other notes are left as written; the target's content is never included. Code is left alone.
 * A placeholder never contains a line break, so the result has exactly the same number of lines as the note.
 * `collect` receives every (placeholder, original) pair so an edit can put the originals back.
 */
export function renderForUpload(markdown: string, collect?: (placeholder: string, original: string) => void): string {
  // two different embeds that share a file name must stay distinguishable, or an edit could restore the wrong one
  const originals = new Map<string, string[]>();
  const placeholder = (name: string, image: boolean) => `[${image ? "Image" : "Attachment"} attachment: ${name} — not synchronized]`;
  const note = (ph: string, original: string) => {
    const seen = originals.get(ph) ?? [];
    if (!originals.has(ph)) originals.set(ph, seen);
    let k = seen.indexOf(original);
    if (k < 0) k = seen.push(original) - 1;
    const shown = k === 0 ? ph : ph.replace(" — not synchronized]", ` (${k + 1}) — not synchronized]`);
    collect?.(shown, original);
    return shown;
  };
  return mapOutsideCode(markdown, (seg) => {
    let out = seg.replace(/(!)\[\[([^\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g, (full, _bang: string, target: string) => {
      const ext = extOf(target);
      if (IMAGE_EXT.has(ext)) return note(placeholder(basename(target.trim()), true), full);
      if (ATTACHMENT_EXT.has(ext)) return note(placeholder(basename(target.trim()), false), full);
      return full;
    });
    out = out.replace(/!\[[^\]\n]*\]\([ \t]*(<[^>\n]+>|[^)\s]+)(?:[ \t]+"[^"\n]*")?[ \t]*\)/g, (full, raw: string) => {
      const t = cleanMdTarget(raw);
      if (isExternal(t)) return full;
      const ext = extOf(t);
      if (IMAGE_EXT.has(ext)) return note(placeholder(basename(t), true), full);
      if (ATTACHMENT_EXT.has(ext)) return note(placeholder(basename(t), false), full);
      return full;
    });
    return out;
  });
}

export type Section = { heading: string | null; text: string };

/**
 * Split Markdown into chunks no longer than `max`, remembering the nearest heading for each. The chunks are an exact
 * partition of the text: concatenating their `content` (with nothing in between) gives the input back, byte for byte.
 */
export function chunkMarkdown(markdown: string, max = 4000): { heading: string | null; content: string }[] {
  if (!markdown.trim()) return [];
  const starts: { at: number; heading: string | null }[] = [{ at: 0, heading: null }];
  let inFence = false;
  let pos = 0;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      if (pos === 0) starts[0].heading = h[2];
      else starts.push({ at: pos, heading: h[2] });
    }
    pos += line.length + 1;
  }
  const sections = starts.map((s, i) => ({ heading: s.heading, text: markdown.slice(s.at, starts[i + 1]?.at ?? markdown.length) }));
  const out: { heading: string | null; content: string }[] = [];
  let acc: { heading: string | null; content: string } | null = null;
  const flush = () => {
    if (acc) out.push(acc);
    acc = null;
  };
  for (const s of sections) {
    if (s.text.length > max) {
      flush();
      for (let i = 0; i < s.text.length; i += max) out.push({ heading: s.heading, content: s.text.slice(i, i + max) });
      continue;
    }
    if (acc && acc.content.length + s.text.length > max) flush();
    acc = acc ? { heading: acc.heading, content: acc.content + s.text } : { heading: s.heading, content: s.text };
  }
  flush();
  // a chunk that is only whitespace is not worth a row: fold it into its neighbour (the text stays complete)
  const merged: typeof out = [];
  for (const c of out) {
    if (!c.content.trim() && merged.length) merged[merged.length - 1].content += c.content;
    else merged.push(c);
  }
  if (merged.length > 1 && !merged[0].content.trim()) {
    const first = merged.shift()!;
    merged[0].content = first.content + merged[0].content;
  }
  return merged;
}
