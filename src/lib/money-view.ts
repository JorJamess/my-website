import type { MoneySummary } from "./money-types";

export type BudgetState = "ok" | "near" | "over";
export type BudgetRow = { id: string; name: string; color: string; spent: number; budget: number; pct: number; state: BudgetState; over: number };

/** Budgets are "near" from 80% used and "over" past 100%. Only expense categories that have a budget count. */
export function budgetRows(summary: Pick<MoneySummary, "byCategory">): BudgetRow[] {
  return summary.byCategory
    .filter((c) => c.type === "expense" && c.monthlyBudget != null && c.monthlyBudget > 0)
    .map((c) => {
      const budget = c.monthlyBudget as number;
      const pct = Math.round((c.amount / budget) * 100);
      const state: BudgetState = c.amount > budget ? "over" : pct >= 80 ? "near" : "ok";
      return { id: c.id, name: c.name, color: c.color, spent: c.amount, budget, pct, state, over: Math.max(0, c.amount - budget) };
    })
    .sort((a, b) => b.pct - a.pct);
}

/** "YYYY-MM" moved by a number of months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** One sentence that names the budgets needing attention, or null when all is fine. */
export function budgetAlert(rows: BudgetRow[], fmt: (n: number) => string): string | null {
  const bits = [
    ...rows.filter((r) => r.state === "over").map((r) => `${r.name} is over by ${fmt(r.over)}`),
    ...rows.filter((r) => r.state === "near").map((r) => `${r.name} is at ${r.pct}% of its budget`),
  ];
  return bits.length ? `${bits.join(". ")}.` : null;
}
