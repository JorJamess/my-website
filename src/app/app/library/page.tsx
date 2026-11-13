import type { Metadata } from "next";
import { LibraryView } from "@/components/app/library-view";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return <LibraryView />;
}
