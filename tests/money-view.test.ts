import { describe, expect, it } from "vitest";
import { budgetAlert, budgetRows, monthBounds, monthLabel, shiftMonth } from "@/lib/money-view";

const cat = (name: string, amount: number, monthlyBudget: number | null, type: "expense" | "income" = "expense") => ({ id: name, name, color: "#000", type, amount, monthlyBudget });

describe("money view", () => {
  it("rates budgets ok, near (80%+) and over, worst first", () => {
    const rows = budgetRows({ byCategory: [cat("Fun", 600, 1500), cat("Food", 2760, 3000), cat("Transport", 1320, 1200), cat("Salary", 100, 50, "income"), cat("Misc", 10, null)] });
    expect(rows.map((r) => [r.name, r.state, r.pct])).toEqual([["Transport", "over", 110], ["Food", "near", 92], ["Fun", "ok", 40]]);
    expect(rows[0].over).toBe(120);
  });
  it("exactly at the budget is near, not over", () => {
    expect(budgetRows({ byCategory: [cat("A", 100, 100)] })[0].state).toBe("near");
  });
  it("writes one alert sentence, or none", () => {
    const rows = budgetRows({ byCategory: [cat("Food", 2760, 3000), cat("Transport", 1320, 1200)] });
    expect(budgetAlert(rows, (n) => `฿${n}`)).toBe("Transport is over by ฿120. Food is at 92% of its budget.");
    expect(budgetAlert(budgetRows({ byCategory: [cat("Fun", 1, 100)] }), String)).toBeNull();
  });
  it("moves months across years and finds the last day", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthLabel("2026-11")).toBe("November 2026");
  });
});
