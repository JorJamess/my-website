import type { Metadata } from "next";
import { HabitsView } from "@/components/app/habits-view";

export const metadata: Metadata = { title: "Habits" };

export default function Page() {
  return <HabitsView />;
}
