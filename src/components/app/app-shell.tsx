"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { ArrowLeft, CalendarDays, ChevronRight, ChartColumn, Wallet, Ellipsis, LayoutGrid, Sprout, Target, Images, ListChecks, Loader2, LogOut, Moon, NotebookPen, Plug, Search, ShieldCheck, Settings, Sun } from "lucide-react";
import { useData } from "@/lib/client/use-data";
import { api, UNAUTHORIZED_EVENT } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LoginScreen } from "./login-screen";
import { Pupu } from "./pupu";
import { SearchButton, SearchPalette } from "./search-palette";

export const SITE_NAME = "jameswebpupu";

const NAV = [
  { href: "/app", label: "Today", icon: LayoutGrid },
  { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/app/todos", label: "To do", icon: ListChecks },
  { href: "/app/habits", label: "Habits", icon: Sprout },
  { href: "/app/goals", label: "Goals", icon: Target },
  { href: "/app/insights", label: "Insights", icon: ChartColumn },
  { href: "/app/money", label: "Money", icon: Wallet },
  { href: "/app/notes", label: "Notes", icon: NotebookPen },
  { href: "/app/library", label: "Library", icon: Images },
  { href: "/app/connect", label: "Claude", icon: Plug },
  { href: "/app/approvals", label: "Approvals", icon: ShieldCheck },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  // how many of Claude's requests wait for a yes (shown as a badge; refreshes after any change and when the tab regains focus)
  const { data: waiting } = useData(() => (authed ? api.approvalCount().catch(() => 0) : Promise.resolve(0)), [authed]);
  const navRef = useRef<HTMLElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const badge = (href: string) => (href === "/app/approvals" && waiting ? waiting : 0);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthed(r.authed))
      .catch(() => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed]);

  // the highlight slides to whichever menu item is current
  useLayoutEffect(() => {
    const place = () => {
      const hl = hlRef.current;
      const cur = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!hl) return;
      if (!cur) {
        hl.style.opacity = "0";
        return;
      }
      hl.style.height = `${cur.offsetHeight}px`;
      hl.style.transform = `translateY(${cur.offsetTop}px)`;
      hl.style.opacity = "1";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pathname, authed]);

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
        <SearchButton onClick={() => setSearchOpen(true)} className="mb-3" />
        <nav ref={navRef} className="relative flex flex-col gap-0.5">
          <div ref={hlRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-9 rounded-lg bg-gradient-to-r from-brand-soft to-brand-soft/20 opacity-0 transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.3,0.9,0.3,1)]" />
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14.5px] text-muted-foreground transition-colors hover:text-foreground",
                isActive(href) && "font-medium text-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-[17px]" strokeWidth={1.7} />
              {label}
              {badge(href) > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] text-white">{badge(href)}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-0.5">
          <BackToPortfolio />
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
            <Button variant="ghost" size="icon-sm" aria-label="Search" title="Search" onClick={() => setSearchOpen(true)}>
              <Search />
            </Button>
            <BackToPortfolio />
            <SettingsLink active={pathname.startsWith("/app/settings")} />
            <ThemeToggle />
            <LogoutButton onDone={() => setAuthed(false)} />
          </div>
        </header>

        <TopBar pathname={pathname} />

        <main key={pathname} className="motion-fade mx-auto w-full max-w-[1080px] flex-1 px-4 pt-6 pb-24 md:px-12 md:pt-5 md:pb-10">
          {children}
        </main>

        {/* Bottom nav (mobile): the five everyday pages, the rest under "More" */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.slice(0, 5).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground",
                isActive(href) && "font-medium text-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={1.7} />
              {label}
            </Link>
          ))}
          <Popover>
            <PopoverTrigger
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground",
                NAV.slice(5).some((n) => isActive(n.href)) && "font-medium text-foreground",
              )}
            >
              <span className="relative">
                <Ellipsis className="size-5" strokeWidth={1.7} />
                {!!waiting && <span aria-label={`${waiting} waiting for approval`} className="absolute -top-0.5 -right-1 size-2 rounded-full bg-brand" />}
              </span>
              More
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-48 p-1.5">
              {NAV.slice(5).map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14.5px] hover:bg-muted", isActive(href) && "bg-brand-soft font-medium")}
                >
                  <Icon className="size-[17px]" strokeWidth={1.7} />
                  {label}
                  {badge(href) > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] text-white">{badge(href)}</span>}
                </Link>
              ))}
            </PopoverContent>
          </Popover>
        </nav>
      </div>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function TopBar({ pathname }: { pathname: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const here = NAV.find((n) => (n.href === "/app" ? pathname === "/app" : pathname.startsWith(n.href)))?.label ?? (pathname.startsWith("/app/settings") ? "Settings" : "");
  return (
    <div className="mx-auto hidden w-full max-w-[1080px] items-center justify-between px-12 pt-6 md:flex">
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <span>{SITE_NAME}</span>
        {here && (
          <>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">{here}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12.5px] text-muted-foreground tabular-nums">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {now.toLocaleDateString("en-GB", { weekday: "short" })}
      </div>
    </div>
  );
}

function BackToPortfolio() {
  return (
    <Button variant="ghost" size="icon-sm" asChild>
      <a href="/" aria-label="Back to portfolio" title="Back to portfolio">
        <ArrowLeft />
      </a>
    </Button>
  );
}

function SettingsLink({ active }: { active: boolean }) {
  return (
    <Button variant="ghost" size="icon-sm" asChild className={cn(active && "bg-brand-soft text-foreground")}>
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
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        // a soft cross-fade where the browser supports it; plain switch elsewhere
        if (document.startViewTransition) document.startViewTransition(() => flushSync(() => setTheme(next)));
        else setTheme(next);
      }}
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
