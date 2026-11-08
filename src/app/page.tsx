import type { Metadata } from "next";
import { DashboardView } from "@/components/app/dashboard-view";

export const metadata: Metadata = { title: "ภาพรวม" };

export default function Page() {
  return <DashboardView />;
}
