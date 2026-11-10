import type { Metadata } from "next";
import { MoneyView } from "@/components/app/money-view";

export const metadata: Metadata = { title: "Money" };

export default function Page() {
  return <MoneyView />;
}
