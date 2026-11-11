"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ListChecks, NotebookPen, Search, Sprout, Target, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { addDaysKey, eventTimeLabel, formatDay, localDateKey, splitLocal } from "@/lib/time";
import type { CalendarEvent, SearchType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EventDialog } from "./event-dialog";
import { Pupu } from "./pupu";
import { SelectField } from "./select-field";

const TYPES: { key: SearchType; label: string; icon: typeof Search }[] = [
  { key: "notes", label: "Notes", icon: NotebookPen },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "goals", label: "Goals", icon: Target },
  { key: "habits", label: "Habits", icon: Sprout },
];
const DATES = [
  { key: "any", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "next7", label: "Next 7 days" },
  { key: "past7", label: "Past 7 days" },
  { key: "month", label: "This month" },
] as const;
type DateKey = (typeof DATES)[number]["key"];

function dateRange(k: DateKey): { from?: string; to?: string } {
  const today = localDateKey();
  if (k === "today") return { from: today, to: today };
  if (k === "next7") return { from: today, to: addDaysKey(today, 7) };
  if (k === "past7") return { from: addDaysKey(today, -7), to: today };
  if (k === "month") return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}31` };
  return {};
}

/** Wraps matches of the query in <mark>. Plain text only, so nothing from a note can inject markup. */
function Highlight({ text, q }: { text: string; q: string }) {
  const term = q.trim();
  if (!term) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, i)) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at} className="rounded-sm bg-amber-200/70 px-0.5 dark:bg-amber-400/25 text-inherit">{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  parts.push(text.slice(i));
  return <>{parts.map((p, k) => <Fragment key={k}>{p}</Fragment>)}</>;
}

/** A short piece of the text around the first match. */
function snippet(text: string, q: string, len = 140) {
  const flat = text.replace(/[#>*`\-\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q.trim().toLowerCase());
  if (at < 0 || flat.length <= len) return flat.slice(0, len);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + len)}…`;
}

function readParams() {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  return {
    q: p.get("q") ?? "",
    type: (TYPES.find((t) => t.key === p.get("type"))?.key ?? "all") as SearchType | "all",
    date: (DATES.find((d) => d.key === p.get("date"))?.key ?? "any") as DateKey,
    status: p.get("status") === "open" || p.get("status") === "done" ? (p.get("status") as "open" | "done") : "",
    folder: p.get("folder") ?? "",
    tag: p.get("tag") ?? "",
  };
}

export function SearchView() {
  const [f, setF] = useState(readParams);
  const [debounced, setDebounced] = useState(f.q);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const set = (patch: Partial<typeof f>) => setF((c) => ({ ...c, ...patch }));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(f.q), 250);
    return () => clearTimeout(t);
  }, [f.q]);

  // keep the address bar in step so a search can be bookmarked or reloaded
  useEffect(() => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.type !== "all") p.set("type", f.type);
    if (f.date !== "any") p.set("date", f.date);
    for (const k of ["status", "folder", "tag"] as const) if (f[k]) p.set(k, f[k]);
    window.history.replaceState(null, "", p.size ? `?${p}` : window.location.pathname);
  }, [f]);

  const { data: folders } = useData(() => api.noteFolders(), []);
  const { data: tags } = useData(() => api.noteTags(), []);
  const active = !!(debounced.trim() || f.folder || f.tag);
  const { data: res, loading } = useData(
    () => (active ? api.searchAll({ q: debounced, ...dateRange(f.date), status: f.status || undefined, folder: f.folder || undefined, tag: f.tag || undefined }) : Promise.resolve(null)),
    [debounced, f.date, f.status, f.folder, f.tag],
  );

  const total = res ? Object.values(res.counts).reduce((a, b) => a + b, 0) : 0;
  const show = (t: SearchType) => f.type === "all" || f.type === t;
  const chip = (on: boolean) => cn("rounded-full px-3 py-1 text-[13px] transition-colors", on ? "bg-brand-soft font-medium text-foreground" : "border text-muted-foreground hover:bg-muted/60");
  const filtered = f.date !== "any" || f.status || f.folder || f.tag;

  const row = "flex w-full items-start gap-3 border-t px-1 py-2.5 text-left transition-colors hover:bg-muted/40";

  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-medium tracking-tight">Search</h1>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search notes, tasks, events, goals and habits…"
          aria-label="Search"
          className="h-11 w-full rounded-lg border bg-card pr-24 pl-9 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {res && <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(f.type === "all")} onClick={() => set({ type: "all" })}>All{res ? ` ${total}` : ""}</button>
        {TYPES.map((t) => (
          <button key={t.key} type="button" className={chip(f.type === t.key)} onClick={() => set({ type: t.key })}>
            {t.label}{res ? ` ${res.counts[t.key]}` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SelectField className="w-36" aria-label="Date" value={f.date} onChange={(e) => set({ date: e.target.value as DateKey })}>
          {DATES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </SelectField>
        <SelectField className="w-32" aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value as "" | "open" | "done" })}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </SelectField>
        <SelectField className="w-36" aria-label="Note folder" value={f.folder} onChange={(e) => set({ folder: e.target.value })}>
          <option value="">Any folder</option>
          {folders?.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
        </SelectField>
        <SelectField className="w-32" aria-label="Note tag" value={f.tag} onChange={(e) => set({ tag: e.target.value })}>
          <option value="">Any tag</option>
          {tags?.map((x) => <option key={x.tag} value={x.tag}>#{x.tag}</option>)}
        </SelectField>
        {filtered && (
          <button type="button" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground" onClick={() => set({ date: "any", status: "", folder: "", tag: "" })}>
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>
      {(f.folder || f.tag) && <p className="text-xs text-muted-foreground">Folder and tag only apply to notes. Status doesn&rsquo;t apply to notes.</p>}

      {!active ? (
        <div className="group/pupu flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
          <Pupu size={72} pose="search" className="mb-2" />
          <p>Type to search everything.</p>
        </div>
      ) : loading && !res ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : res && total === 0 ? (
        <div className="group/pupu flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
          <Pupu size={72} pose="search" className="mb-2" />
          <p>Nothing found{debounced.trim() ? <> for &ldquo;{debounced.trim()}&rdquo;</> : ""}{filtered ? ". Try clearing a filter." : "."}</p>
        </div>
      ) : (
        res && (
          <div className="space-y-5">
            {show("notes") && res.notes.length > 0 && (
              <section aria-label="Notes">
                <h2 className="mb-1 text-xs text-muted-foreground">Notes</h2>
                {res.notes.map((n) => (
                  // a full page load so the notes page re-reads ?id
                  <a key={n.id} href={`/app/notes?id=${n.id}`} className={row}>
                    <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium"><Highlight text={n.title} q={debounced} /></span>
                      {n.content && <span className="mt-0.5 block text-[13px] text-muted-foreground"><Highlight text={snippet(n.content, debounced)} q={debounced} /></span>}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {n.folder?.name}{n.folder && n.tags.length ? " · " : ""}{n.tags.slice(0, 3).map((t) => `#${t}`).join(" ")}
                    </span>
                  </a>
                ))}
              </section>
            )}
            {show("tasks") && res.tasks.length > 0 && (
              <section aria-label="Tasks">
                <h2 className="mb-1 text-xs text-muted-foreground">Tasks</h2>
                {res.tasks.map((t) => (
                  <Link key={t.id} href={`/app/todos?id=${t.id}`} className={row}>
                    <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span className={cn("min-w-0 flex-1 truncate text-[15px]", t.done && "text-muted-foreground line-through")}><Highlight text={t.title} q={debounced} /></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t.done ? "Done" : t.due_date ? `Due ${formatDay(t.due_date, { day: "numeric", month: "short" })}` : ""}</span>
                  </Link>
                ))}
              </section>
            )}
            {show("events") && res.events.length > 0 && (
              <section aria-label="Events">
                <h2 className="mb-1 text-xs text-muted-foreground">Events</h2>
                {res.events.map((e) => (
                  <button key={e.id} type="button" className={row} onClick={() => setEvent(e)}>
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span className="min-w-0 flex-1 truncate text-[15px]"><Highlight text={e.title} q={debounced} /></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDay(splitLocal(e.start_at).date, { day: "numeric", month: "short" })} · {eventTimeLabel(e)}</span>
                  </button>
                ))}
              </section>
            )}
            {show("goals") && res.goals.length > 0 && (
              <section aria-label="Goals">
                <h2 className="mb-1 text-xs text-muted-foreground">Goals</h2>
                {res.goals.map((g) => (
                  <Link key={g.id} href={`/app/goals/${g.id}`} className={row}>
                    <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span className="min-w-0 flex-1 truncate text-[15px]"><Highlight text={g.title} q={debounced} /></span>
                    <span className="shrink-0 text-xs capitalize text-muted-foreground">{g.status}</span>
                  </Link>
                ))}
              </section>
            )}
            {show("habits") && res.habits.length > 0 && (
              <section aria-label="Habits">
                <h2 className="mb-1 text-xs text-muted-foreground">Habits</h2>
                {res.habits.map((h) => (
                  <Link key={h.id} href={`/app/habits?id=${h.id}`} className={row}>
                    <Sprout className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span className="min-w-0 flex-1 truncate text-[15px]"><Highlight text={h.title} q={debounced} /></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.archived ? "Archived" : ""}</span>
                  </Link>
                ))}
              </section>
            )}
          </div>
        )
      )}
      <EventDialog open={!!event} event={event} onOpenChange={(o) => !o && setEvent(null)} />
    </div>
  );
}
