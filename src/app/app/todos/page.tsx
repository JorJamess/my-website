import type { Metadata } from "next";
import { TodosView } from "@/components/app/todos-view";

export const metadata: Metadata = { title: "To do" };

export default function Page() {
  return <TodosView />;
}
