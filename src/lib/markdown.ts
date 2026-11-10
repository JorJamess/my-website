/**
 * A small, safe Markdown parser for notes. It produces a plain data tree (no HTML strings),
 * so the renderer builds React elements and nothing from a note can inject markup.
 * Supports: # headings, paragraphs, **bold**, *italic*, `code`, ``` fences, - lists, 1. lists,
 * - [ ] task items, > quotes, --- rules, and [text](https://…) links (http/https/mailto only).
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Inline[] }
  | { t: "hr" }
  | { t: "list"; ordered: boolean; items: { checked: boolean | null; c: Inline[]; line: number }[] };

export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#>-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "bold", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = src.indexOf(ch, i + 1);
      const prev = i === 0 ? " " : src[i - 1];
      if (end > i + 1 && src[i + 1] !== " " && (ch === "*" || /\W/.test(prev))) {
        flush();
        out.push({ t: "italic", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        flush();
        if (href) out.push({ t: "link", href, c: parseInline(m[1]) });
        else out.push({ t: "text", v: m[1] });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: "code", v: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: "heading", level: h[1].length as 1 | 2 | 3, c: parseInline(h[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: "hr" });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      blocks.push({ t: "quote", c: parseInline(line.replace(/^>\s?/, "")) });
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      flushPara();
      const ordered = !!o;
      const last = blocks[blocks.length - 1];
      const list =
        last && last.t === "list" && last.ordered === ordered
          ? last
          : (blocks[blocks.push({ t: "list", ordered, items: [] }) - 1] as Extract<Block, { t: "list" }>);
      const text = (b ?? o)![1];
      const task = ordered ? null : TASK.exec(text);
      list.items.push({ checked: task ? task[1] !== " " : null, c: parseInline(task ? task[2] : text), line: i });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Flip the "- [ ]" / "- [x]" box on a given line of the source; returns the new source. */
export function toggleTaskLine(src: string, line: number): string {
  const lines = src.split("\n");
  if (line < 0 || line >= lines.length) return src;
  lines[line] = lines[line].replace(/^(\s*[-*+]\s+)\[([ xX])\]/, (_m, pre: string, mark: string) => `${pre}[${mark === " " ? "x" : " "}]`);
  return lines.join("\n");
}
