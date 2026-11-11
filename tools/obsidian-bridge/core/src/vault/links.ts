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

/**
 * The text that is sent to the cloud: images and other attachments become placeholders (the files themselves never
 * leave the Mac). Links to other notes are left as written; the target's content is never included.
 */
export function renderForUpload(markdown: string): string {
  const placeholder = (name: string, image: boolean) => `[${image ? "Image" : "Attachment"} attachment: ${name} — not synchronized]`;
  let out = markdown.replace(/(!)\[\[([^\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g, (full, _bang: string, target: string) => {
    const ext = extOf(target);
    if (IMAGE_EXT.has(ext)) return placeholder(basename(target.trim()), true);
    if (ATTACHMENT_EXT.has(ext)) return placeholder(basename(target.trim()), false);
    return full;
  });
  out = out.replace(/!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g, (full, raw: string) => {
    const t = cleanMdTarget(raw);
    if (isExternal(t)) return full;
    const ext = extOf(t);
    if (IMAGE_EXT.has(ext)) return placeholder(basename(t), true);
    if (ATTACHMENT_EXT.has(ext)) return placeholder(basename(t), false);
    return full;
  });
  return out;
}

export type Section = { heading: string | null; text: string };

/** Split Markdown into chunks no longer than `max`, remembering the nearest heading for each. */
export function chunkMarkdown(markdown: string, max = 4000): { heading: string | null; content: string }[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let cur: Section = { heading: null, text: "" };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      if (cur.text.trim()) sections.push(cur);
      cur = { heading: h[2], text: `${line}\n` };
    } else cur.text += `${line}\n`;
  }
  if (cur.text.trim()) sections.push(cur);
  const out: { heading: string | null; content: string }[] = [];
  let acc: { heading: string | null; content: string } | null = null;
  const flush = () => {
    if (acc && acc.content.trim()) out.push({ heading: acc.heading, content: acc.content.trimEnd() });
    acc = null;
  };
  for (const s of sections) {
    const text = s.text;
    if (text.length > max) {
      flush();
      for (let i = 0; i < text.length; i += max) out.push({ heading: s.heading, content: text.slice(i, i + max).trimEnd() });
      continue;
    }
    if (acc && acc.content.length + text.length > max) flush();
    acc = acc ? { heading: acc.heading, content: acc.content + text } : { heading: s.heading, content: text };
  }
  flush();
  return out.filter((c) => c.content.trim());
}
