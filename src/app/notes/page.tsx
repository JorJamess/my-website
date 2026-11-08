import type { Metadata } from "next";
import { NotesView } from "@/components/app/notes-view";

export const metadata: Metadata = { title: "Notes" };

export default function Page() {
  return <NotesView />;
}
