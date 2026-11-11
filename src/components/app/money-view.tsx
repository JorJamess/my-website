"use client";

import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatBaht, MONEY_APP_URL } from "@/lib/money-types";
import { budgetAlert, budgetRows, monthBounds, monthLabel, shiftMonth } from "@/lib/money-view";
import { formatDay, localDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Pupu } from "./pupu";

const BAR = { ok: "bg-foreground/70", near: "bg-amber-500", over: "bg-destructive" } as const;

export function MoneyView() {
  const thisMonth = localDateKey().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading } = useData(() => api.moneySummary(month), [month]);
  const { from, to } = monthBounds(month);
  // bills due this month that haven't passed yet (all of them for a future month)
  const { data: cal } = useData(() => api.moneyCalendar(month === thisMonth ? localDateKey() : from, to).catch(() => null), [month]);

  const rows = data ? budgetRows(data) : [];
  const alert = budgetAlert(rows, formatBaht);
  const unbudgeted = (data?.byCategory ?? []).filter((c) => c.type === "expense" && !(c.monthlyBudget && c.monthlyBudget > 0) && c.amount > 0).sort((a, b) => b.amount - a.amount);
  const bills = (cal?.recurring ?? [])
    .filter((r) => r.type === "expense")
    .flatMap((r) => r.dueDates.map((d) => ({ id: `${r.id}:${d}`, name: r.name, date: d, amount: r.amount })))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-medium tracking-tight">Money</h1>
        <div className="ml-auto flex items-center gap-1 text-[14px]">
          <button type="button" aria-label="Previous month" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-32 text-center">{monthLabel(month)}</span>
          <button type="button" aria-label="Next month" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="group/pupu flex items-center gap-3 py-6">
          <Pupu pose="oops" size={56} />
          <p className="text-sm text-muted-foreground">Couldn&rsquo;t load money data. {error}.</p>
        </div>
      ) : loading && !data ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : data ? (
        <>
          {alert && (
            <div role="status" className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-[13.5px] text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{alert}</span>
            </div>
          )}

          <dl className="motion-fade grid grid-cols-3 gap-2.5">
            <Figure label="Income" value={data.income} />
            <Figure label="Spent" value={data.expense} />
            <Figure label="Left" value={data.net} className={data.net < 0 ? "text-destructive" : "text-positive"} />
          </dl>

          <section aria-label="Budgets">
            <h2 className="mb-2 text-xs text-muted-foreground">Budgets</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No budgets set for this month. Set them in the money app.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.id}>
                    <div className="flex items-baseline gap-2 text-[14.5px]">
                      <span>{r.name}</span>
                      <span className={cn("ml-auto text-[13px] tabular-nums", r.state === "over" ? "text-destructive" : "text-muted-foreground")}>
                        {formatBaht(r.spent)} of {formatBaht(r.budget)}
                        {r.state === "over" && " · over"}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${r.name}: ${r.pct}% of budget used`}>
                      <div className={cn("h-full rounded-full", BAR[r.state])} style={{ width: `${Math.min(100, r.pct)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {unbudgeted.length > 0 && (
            <section aria-label="Spending without a budget">
              <h2 className="mb-1 text-xs text-muted-foreground">Spending without a budget</h2>
              {unbudgeted.map((c) => (
                <div key={c.id} className="flex items-baseline gap-2 border-t py-2.5 text-[14.5px]">
                  <span>{c.name}</span>
                  <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">{formatBaht(c.amount)}</span>
                </div>
              ))}
            </section>
          )}

          <section aria-label="Bills coming up">
            <h2 className="mb-1 text-xs text-muted-foreground">Bills coming up</h2>
            {bills.length === 0 ? (
              <p className="border-t py-3 text-sm text-muted-foreground">No bills due {month === thisMonth ? "for the rest of this month" : "this month"}.</p>
            ) : (
              bills.map((b) => (
                <div key={b.id} className="flex items-baseline gap-2 border-t py-2.5 text-[14.5px]">
                  <span>{b.name}</span>
                  <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">
                    {formatDay(b.date, { month: "short", day: "numeric" })} · {formatBaht(b.amount)}
                  </span>
                </div>
              ))
            )}
          </section>

          <a href={MONEY_APP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground underline-offset-4 hover:text-brand hover:underline">
            Read-only here. Add or edit in the money app <ExternalLink className="size-3" />
          </a>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2.5">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[20px] font-medium tracking-tight tabular-nums", className)}>{formatBaht(value)}</dd>
    </div>
  );
}
