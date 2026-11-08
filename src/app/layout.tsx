import type { Metadata, Viewport } from "next";
import { Anuphan, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/app/app-shell";
import "./globals.css";

const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "jameswebpupu", template: "%s · jameswebpupu" },
  description: "James's calendar, notes and money in one place",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFBFA" },
    { media: "(prefers-color-scheme: dark)", color: "#141517" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${anuphan.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppShell>{children}</AppShell>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
