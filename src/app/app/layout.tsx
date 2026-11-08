import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: { default: "jameswebpupu", template: "%s · jameswebpupu" },
};

export default function PrivateAppLayout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}
