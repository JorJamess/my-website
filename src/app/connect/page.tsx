import type { Metadata } from "next";
import { ConnectView } from "@/components/app/connect-view";

export const metadata: Metadata = { title: "เชื่อม Claude" };

export default function Page() {
  return <ConnectView />;
}
