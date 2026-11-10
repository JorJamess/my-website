import { ListChecks, Sprout, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: "habit", icon: Sprout, name: "Habit", when: "Something you repeat", eg: "Gym 3× a week, read 20 min daily" },
  { key: "goal", icon: Target, name: "Goal", when: "An outcome that takes weeks", eg: "Pass JLPT N4, finish the portfolio" },
  { key: "task", icon: ListChecks, name: "To-do", when: "A one-off thing to finish", eg: "Email the professor, submit the lab" },
] as const;

/** A three-line guide to which of habit / goal / to-do fits; the one being created is highlighted. */
export function KindHint({ current, className }: { current: "habit" | "goal" | "task"; className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-muted/40 p-2.5 text-[12.5px]", className)}>
      <p className="mb-1.5 font-medium text-foreground">Not sure which to pick?</p>
      <ul className="space-y-1.5">
        {KINDS.map((k) => (
          <li key={k.key} className={cn("flex items-start gap-2", k.key === current ? "text-foreground" : "text-muted-foreground")}>
            <k.icon className={cn("mt-0.5 size-3.5 shrink-0", k.key === current && "text-brand")} strokeWidth={1.8} />
            <span>
              <span className="font-medium">{k.name}</span> — {k.when}
              <span className="block text-[11.5px] opacity-80">e.g. {k.eg}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-muted-foreground">Goals can link habits and to-dos, so a goal&rsquo;s progress comes from them.</p>
    </div>
  );
}
