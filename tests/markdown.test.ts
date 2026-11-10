import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref, toggleTaskLine } from "@/lib/markdown";

describe("markdown", () => {
  it("parses headings, paragraphs and joins wrapped lines", () => {
    const b = parseMarkdown("# Title\n\nfirst line\nsecond line\n\n## Sub");
    expect(b.map((x) => x.t)).toEqual(["heading", "p", "heading"]);
    expect(b[1]).toMatchObject({ t: "p", c: [{ t: "text", v: "first line second line" }] });
  });
  it("parses bold, italic, code and links", () => {
    expect(parseInline("a **b** *c* `d` [e](https://x.dev)")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "code", v: "d" },
      { t: "text", v: " " },
      { t: "link", href: "https://x.dev", c: [{ t: "text", v: "e" }] },
    ]);
  });
  it("drops unsafe link targets but keeps the text", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(parseInline("[x](javascript:alert)")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
  it("parses lists and task items with their source line", () => {
    const b = parseMarkdown("- one\n- [ ] two\n- [x] three\n\n1. a\n2. b");
    expect(b[0]).toMatchObject({ t: "list", ordered: false });
    const items = (b[0] as Extract<(typeof b)[number], { t: "list" }>).items;
    expect(items.map((i) => i.checked)).toEqual([null, false, true]);
    expect(items[1].line).toBe(1);
    expect(b[1]).toMatchObject({ t: "list", ordered: true });
  });
  it("keeps code fences literal", () => {
    expect(parseMarkdown("```\n# not a heading\n**x**\n```")).toEqual([{ t: "code", v: "# not a heading\n**x**" }]);
  });
  it("toggles a task box on one line only", () => {
    const src = "- [ ] a\n- [x] b";
    expect(toggleTaskLine(src, 0)).toBe("- [x] a\n- [x] b");
    expect(toggleTaskLine(src, 1)).toBe("- [ ] a\n- [ ] b");
    expect(toggleTaskLine(src, 9)).toBe(src);
  });
});
