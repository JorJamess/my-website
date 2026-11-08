import type { Metadata } from "next";
import { ConnectView } from "@/components/app/connect-view";

export const metadata: Metadata = { title: "Claude" };

export default function Page() {
  return <ConnectView />;
}
