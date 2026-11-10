import { Fragment } from "react";
import { Check } from "lucide-react";
import { parseMarkdown, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "bold":
            return <strong key={i} className="font-semibold"><Inlines nodes={n.c} /></strong>;
          case "italic":
            return <em key={i}><Inlines nodes={n.c} /></em>;
          case "code":
            return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{n.v}</code>;
          case "link":
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">
                <Inlines nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

/** Renders note Markdown as React elements (never raw HTML). Task boxes toggle through `onToggleTask(sourceLine)`. */
export function MarkdownView({ source, onToggleTask, className }: { source: string; onToggleTask?: (line: number) => void; className?: string }) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>;
  return (
    <div className={cn("space-y-3 text-[15px] leading-relaxed break-words", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading": {
            const cls = b.level === 1 ? "text-xl font-semibold" : b.level === 2 ? "text-lg font-semibold" : "text-base font-semibold";
            return <p key={i} role="heading" aria-level={b.level} className={cls}><Inlines nodes={b.c} /></p>;
          }
          case "p":
            return <p key={i}><Inlines nodes={b.c} /></p>;
          case "quote":
            return <blockquote key={i} className="border-l-2 border-brand/40 pl-3 text-muted-foreground"><Inlines nodes={b.c} /></blockquote>;
          case "hr":
            return <hr key={i} className="border-border" />;
          case "code":
            return <pre key={i} className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px]"><code>{b.v}</code></pre>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={cn("space-y-1 pl-5", b.ordered ? "list-decimal" : "list-disc", b.items.some((x) => x.checked !== null) && "list-none pl-0")}>
                {b.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2">
                    {it.checked !== null && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={it.checked}
                        aria-label="Toggle task"
                        disabled={!onToggleTask}
                        onClick={() => onToggleTask?.(it.line)}
                        className={cn(
                          "mt-[3px] flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                          it.checked ? "border-brand bg-brand text-white" : "border-input bg-card",
                        )}
                      >
                        {it.checked && <Check className="size-3" strokeWidth={3} />}
                      </button>
                    )}
                    <span className={cn(it.checked && "text-muted-foreground line-through")}><Inlines nodes={it.c} /></span>
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
