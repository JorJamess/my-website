import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A native <select> (best on phones) with our own chevron, so the arrow sits a comfortable distance from the edge. */
export function SelectField({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        {...props}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border bg-card pr-8 pl-3 text-[13.5px] text-foreground outline-none transition-colors hover:border-input focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
