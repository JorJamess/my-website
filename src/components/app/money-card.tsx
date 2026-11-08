"use client";

import { ExternalLink } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatBaht, MONEY_APP_URL } from "@/lib/money-types";
import { cn } from "@/lib/utils";

/** การ์ดการเงินเดือนนี้ (ข้อมูลจากแอปเงิน) */
export function MoneyCard() {
  const { data, error, loading } = useData(() => api.moneySummary(), []);
  const expenses = (data?.byCategory ?? []).filter((c) => c.type === "expense" && c.amount > 0);
  const total = expenses.reduce((s, c) => s + c.amount, 0) || 1;
  const shown = expenses.slice(0, 5);

  return (
    <div className="rounded-[14px] border bg-card px-5 py-4">
      {loading && !data && !error ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">ดึงข้อมูลจากแอปเงินไม่ได้: {error}</p>
      ) : data ? (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Figure label="รายรับ" value={data.income} />
            <Figure label="รายจ่าย" value={data.expense} />
            <Figure label="คงเหลือ" value={data.net} className={data.net < 0 ? "text-destructive" : "text-positive"} />
          </dl>
          {shown.length > 0 && (
            <>
              <div className="mt-4 flex h-1 overflow-hidden rounded-full bg-muted" role="img" aria-label="สัดส่วนรายจ่ายตามหมวด">
                {shown.map((c) => (
                  <span key={c.id} className="h-full" style={{ width: `${(c.amount / total) * 100}%`, background: c.color }} />
                ))}
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted-foreground">
                {shown.map((c) => {
                  const over = c.monthlyBudget != null && c.amount > c.monthlyBudget;
                  return (
                    <li key={c.id} title={`${c.name} ${formatBaht(c.amount)}`} className={cn(over && "text-destructive")}>
                      <span className="mr-1.5 inline-block size-[7px] rounded-full" style={{ background: c.color }} />
                      {c.name}
                      {over && " เกินงบ"}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <a
            href={MONEY_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            เปิดแอปเงิน <ExternalLink className="size-3" />
          </a>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[19px] font-medium tracking-tight tabular-nums", className)}>{formatBaht(value)}</dd>
    </div>
  );
}
