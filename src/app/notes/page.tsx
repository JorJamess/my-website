import type { Metadata } from "next";
import { NotesView } from "@/components/app/notes-view";

export const metadata: Metadata = { title: "บันทึก" };

export default function Page() {
  return <NotesView />;
}
