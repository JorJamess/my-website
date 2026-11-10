import type { Metadata } from "next";
import { GoalDetailView } from "@/components/app/goal-detail-view";

export const metadata: Metadata = { title: "Goal" };

export default async function Page({ params }: PageProps<"/app/goals/[id]">) {
  const { id } = await params;
  return <GoalDetailView id={id} />;
}
