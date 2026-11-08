"use client";

import { ArrowDownLeft, ArrowUpRight, ExternalLink, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatBaht, MONEY_APP_URL } from "@/lib/money-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MoneyCard() {
  const { data, error, loading } = useData(() => api.moneySummary(), []);
  const top = (data?.byCategory ?? []).filter((c) => c.type === "expense" && c.amount > 0).slice(0, 4);
  const maxAmount = Math.max(1, ...top.map((c) => Math.max(c.amount, c.monthlyBudget ?? 0)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-4" /> การเงินเดือนนี้
        </CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <a href={MONEY_APP_URL} target="_blank" rel="noreferrer">
              แอปเงิน <ExternalLink />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data && !error ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">ยังดึงข้อมูลจากแอปเงินไม่ได้ — {error}</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Figure label="รายรับ" value={data.income} icon={<ArrowDownLeft className="size-3.5 text-emerald-500" />} />
              <Figure label="รายจ่าย" value={data.expense} icon={<ArrowUpRight className="size-3.5 text-red-500" />} />
              <Figure
                label="คงเหลือ"
                value={data.net}
                className={data.net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
              />
            </div>
            {top.length > 0 && (
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">ใช้จ่ายมากสุด</p>
                {top.map((c) => {
                  const over = c.monthlyBudget != null && c.amount > c.monthlyBudget;
                  return (
                    <div key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className={cn("shrink-0 tabular-nums", over && "text-red-600 dark:text-red-400")}>
                          {formatBaht(c.amount)}
                          {c.monthlyBudget != null && (
                            <span className="text-xs text-muted-foreground"> / {formatBaht(c.monthlyBudget)}</span>
                          )}
                        </span>
                      </div>
                      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.min(100, (c.amount / maxAmount) * 100)}%`,
                            background: over ? "var(--destructive)" : c.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, icon, className }: { label: string; value: number; icon?: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn("truncate text-base font-semibold tabular-nums", className)}>{formatBaht(value)}</p>
    </div>
  );
}
