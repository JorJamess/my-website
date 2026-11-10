import type { Metadata } from "next";
import { SearchView } from "@/components/app/search-view";

export const metadata: Metadata = { title: "Search" };

export default function Page() {
  return <SearchView />;
}
