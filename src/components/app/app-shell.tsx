"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { CalendarDays, LayoutGrid, Loader2, LogOut, Moon, NotebookPen, Plug, Settings, Sun } from "lucide-react";
import { api, UNAUTHORIZED_EVENT } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LoginScreen } from "./login-screen";
import { Pupu } from "./pupu";

export const SITE_NAME = "jameswebpupu";

const NAV = [
  { href: "/app", label: "Today", icon: LayoutGrid },
  { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/app/notes", label: "Notes", icon: NotebookPen },
  { href: "/app/connect", label: "Claude", icon: Plug },
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

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r px-4 py-7 md:flex">
        <Link href="/app" className="group/pupu mb-6 flex items-center gap-2 px-1.5 text-[15px] font-semibold tracking-tight">
          <Pupu size={30} />
          {SITE_NAME}
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14.5px] text-muted-foreground transition-colors hover:text-foreground",
                isActive(href) && "bg-brand-soft font-medium text-brand hover:text-brand",
              )}
            >
              <Icon className="size-[17px]" strokeWidth={1.7} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-0.5">
          <SettingsLink active={pathname.startsWith("/app/settings")} />
          <ThemeToggle />
          <LogoutButton onDone={() => setAuthed(false)} />
          <span className="ml-auto pr-1 font-mono text-[10px] text-muted-foreground/60" title="Deployed version">
            {process.env.NEXT_PUBLIC_COMMIT}
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background/85 px-4 backdrop-blur md:hidden">
          <Link href="/app" className="group/pupu flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
            <Pupu size={26} />
            {SITE_NAME}
          </Link>
          <div className="flex items-center gap-0.5">
            <SettingsLink active={pathname.startsWith("/app/settings")} />
            <ThemeToggle />
            <LogoutButton onDone={() => setAuthed(false)} />
          </div>
        </header>

        <main key={pathname} className="motion-fade mx-auto w-full max-w-[1080px] flex-1 px-4 pt-6 pb-24 md:px-12 md:py-10">
          {children}
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground",
                isActive(href) && "font-medium text-brand",
              )}
            >
              <Icon className="size-5" strokeWidth={1.7} />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function SettingsLink({ active }: { active: boolean }) {
  return (
    <Button variant="ghost" size="icon-sm" asChild className={cn(active && "bg-brand-soft text-brand")}>
      <Link href="/app/settings" aria-label="Settings" title="Settings" aria-current={active ? "page" : undefined}>
        <Settings />
      </Link>
    </Button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Switch light or dark theme"
      title="Switch theme"
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
      aria-label="Log out"
      title="Log out"
      onClick={async () => {
        await api.logout().catch(() => {});
        onDone();
      }}
    >
      <LogOut />
    </Button>
  );
}
