import type { Metadata } from "next";
import { DashboardView } from "@/components/app/dashboard-view";

export const metadata: Metadata = { title: { absolute: "Today · jameswebpupu" } };

export default function Page() {
  return <DashboardView />;
}
