"use client";

import { Receipt } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatBaht, type MoneyDay, type MoneyRecurring } from "@/lib/money-types";
import { cn } from "@/lib/utils";

/** ส่วน "การเงิน" ของวันที่เลือกในปฏิทิน */
export function DayMoney({ date, day, bills }: { date: string; day?: MoneyDay; bills: MoneyRecurring[] }) {
  const { data: txs } = useData(
    () => (day?.count ? api.moneyTransactions(date, date) : Promise.resolve([])),
    [date, day?.count],
  );
  if (!day && bills.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>การเงิน</span>
        {day && (
          <span className="tabular-nums">
            {day.income > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatBaht(day.income)} </span>}
            {day.expense > 0 && <span className="text-red-600 dark:text-red-400">−{formatBaht(day.expense)}</span>}
          </span>
        )}
      </div>

      {bills.map((b) => (
        <div key={b.id} className="flex items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 text-sm">
          <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {b.name}
            <span className="ml-1 text-xs text-muted-foreground">ครบกำหนด{b.mode === "auto" ? " (ตัดอัตโนมัติ)" : ""}</span>
          </span>
          <span className={cn("shrink-0 tabular-nums", b.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "")}>
            {formatBaht(b.amount)}
          </span>
        </div>
      ))}

      {txs?.map((t) => (
        <div key={t.id} className="flex items-center gap-2 px-2 text-sm">
          <span className="size-2 shrink-0 rounded-full" style={{ background: t.category?.color ?? "#94a3b8" }} />
          <span className="min-w-0 flex-1 truncate">
            {t.note || t.category?.name || "ไม่ระบุ"}
            <span className="ml-1 text-xs text-muted-foreground tabular-nums">{t.time}</span>
          </span>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}
          >
            {t.type === "income" ? "+" : "−"}
            {formatBaht(t.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}
