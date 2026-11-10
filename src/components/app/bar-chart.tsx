import { cn } from "@/lib/utils";

export type Bar = { label: string; value: number; title: string; muted?: boolean };

/**
 * A small SVG bar chart. It uses raw counts only: the number is printed above each bar when there are
 * few bars, otherwise it's in the tooltip. Bars for days that haven't happened yet are drawn faint.
 */
export function BarChart({ bars, ariaLabel, className }: { bars: Bar[]; ariaLabel: string; className?: string }) {
  const W = 100;
  const H = 46;
  const top = 8;
  const base = H - 8;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = W / bars.length;
  const bw = Math.min(slot * 0.55, 4.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className={cn("w-full overflow-visible", className)} preserveAspectRatio="none" style={{ height: 160 }}>
      <line x1="0" y1={base} x2={W} y2={base} stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
      {bars.map((b, i) => {
        const h = b.value ? Math.max(1.4, (b.value / max) * (base - top)) : 0;
        const x = i * slot + (slot - bw) / 2;
        return (
          <g key={i}>
            <title>{b.title}</title>
            {b.value > 0 ? (
              <rect x={x} y={base - h} width={bw} height={h} rx="0.9" className={cn("fill-foreground", b.muted && "opacity-30")} />
            ) : (
              <rect x={x} y={base - 0.6} width={bw} height="0.6" rx="0.3" className="fill-foreground opacity-20" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Labels and values under/over a BarChart, drawn as HTML so the text isn't stretched by the SVG scaling. */
export function BarChartLabels({ bars, labelEvery = 1, showValues }: { bars: Bar[]; labelEvery?: number; showValues: boolean }) {
  return (
    <div className="flex" aria-hidden>
      {bars.map((b, i) => (
        <div key={i} className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground tabular-nums">
          {showValues && <div className={cn("h-4 font-medium", b.value ? "text-foreground" : "opacity-0")}>{b.value || 0}</div>}
          <div className={cn(i % labelEvery !== 0 && "invisible")}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}
