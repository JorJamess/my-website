"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Moon,
  NotebookPen,
  Plug,
  Sun,
  Loader2,
} from "lucide-react";
import { api, UNAUTHORIZED_EVENT } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LoginScreen } from "./login-screen";

const NAV = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/calendar", label: "ปฏิทิน", icon: CalendarDays },
  { href: "/notes", label: "บันทึก", icon: NotebookPen },
  { href: "/connect", label: "เชื่อม Claude", icon: Plug },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthed(r.authed))
      .catch(() => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (authed === null)
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDays className="size-4" />
          </span>
          My Website
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                isActive(href) && "bg-sidebar-accent font-medium text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-1 px-1">
          <ThemeToggle />
          <LogoutButton onDone={() => setAuthed(false)} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <CalendarDays className="size-4" /> My Website
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton onDone={() => setAuthed(false)} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 md:px-8 md:py-8">{children}</main>

        {/* Bottom nav (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground",
                isActive(href) && "text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="สลับธีม"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

function LogoutButton({ onDone }: { onDone: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="ออกจากระบบ"
      title="ออกจากระบบ"
      onClick={async () => {
        await api.logout().catch(() => {});
        onDone();
      }}
    >
      <LogOut />
    </Button>
  );
}
