// รูปแบบข้อมูลจาก Integration API ของแอปเงิน (money-tracker) — จำนวนเงินเป็นบาท
export const MONEY_APP_URL = "https://money-tracker.komolbunrueang.workers.dev";

export type MoneyCategoryRef = { id?: string; name: string; icon?: string; color: string };

export type MoneySummary = {
  currency: "THB";
  month: string;
  income: number;
  expense: number;
  net: number;
  byCategory: (MoneyCategoryRef & { id: string; type: "income" | "expense"; amount: number; monthlyBudget: number | null })[];
  wallets: { id: string; name: string; type: string; balance: number }[];
};

export type MoneyDay = { date: string; income: number; expense: number; count: number };

export type MoneyTransaction = {
  id: string;
  date: string;
  time: string;
  type: "income" | "expense" | string;
  amount: number;
  category: MoneyCategoryRef | null;
  wallet: { id: string; name: string } | null;
  note: string | null;
};

export type MoneyRecurring = {
  id: string;
  name: string;
  type: "income" | "expense" | string;
  amount: number;
  frequency: "weekly" | "monthly" | "yearly" | string;
  mode: string;
  category: MoneyCategoryRef | null;
  dueDates: string[];
};

export type MoneyCalendar = { days: MoneyDay[]; recurring: MoneyRecurring[] };

const baht = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const formatBaht = (n: number) => baht.format(n);
export const formatBahtShort = (n: number) =>
  n >= 10_000 ? `฿${(n / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}k` : `฿${Math.round(n).toLocaleString("th-TH")}`;
