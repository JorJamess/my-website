"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Folder, Loader2, LayoutGrid, List, Play, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { api, type LibraryItem, type LibraryList } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const KINDS = [
  ["all", "All"],
  ["image", "Photos"],
  ["video", "Videos"],
  ["pdf", "PDFs"],
] as const;

const ERRORS: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in.",
  bad_state: "The sign-in link expired. Try again.",
  no_refresh_token: "Google did not give long-lived access. Remove this app at myaccount.google.com/permissions, then connect again.",
  scope_not_granted: "Drive read access was not granted. Tick the Drive permission on Google's screen.",
  google_not_configured: "Google is not set up on the server yet (missing client secret).",
  token_exchange_failed: "Google refused the sign-in. Check the client secret and redirect URI.",
};

function fmtSize(n: number | null) {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
function fmtDur(s: number | null) {
  if (s == null) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function FolderCard({ folder, onOpen }: { folder: LibraryItem; onOpen: () => void }) {
  const [noCover, setNoCover] = useState(false);
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-lg border bg-card text-left transition hover:-translate-y-0.5">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {!noCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/library/cover/${folder.id}?s=360`} alt="" loading="lazy" onError={() => setNoCover(true)} className="size-full object-cover transition group-hover:scale-[1.04]" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Folder className="size-9" />
          </div>
        )}
        <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 text-white">
          <Folder className="size-4" />
        </span>
      </div>
      <b className="block truncate px-3 py-2.5 text-[14px] font-medium">{folder.name}</b>
    </button>
  );
}

function Thumb({ item, className }: { item: LibraryItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!item.hasThumb || failed)
    return (
      <div className={cn("grid place-items-center bg-muted text-muted-foreground", className)} style={{ aspectRatio: "4 / 3" }}>
        {item.kind === "pdf" ? <FileText className="size-8" /> : <Folder className="size-8" />}
      </div>
    );
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "4 / 3";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/library/thumb/${item.id}?s=480`} alt={item.name} loading="lazy" onError={() => setFailed(true)} className={cn("w-full bg-muted object-cover", className)} style={{ aspectRatio: ratio }} />
  );
}

export function LibraryView() {
  const params = useSearchParams();
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  // extra pages are tied to the page they were loaded after, so they reset themselves when the folder changes
  const [paged, setPaged] = useState<{ base: LibraryList | null; items: LibraryItem[]; next: string | null }>({ base: null, items: [], next: null });
  const [more, setMore] = useState(false);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const status = useData(() => api.libraryStatus(), []);
  const connected = status.data?.connected && !!status.data.folderId;
  const list = useData<LibraryList | null>(() => (connected ? api.libraryItems(folder) : Promise.resolve(null)), [connected, folder]);

  const samePage = paged.base === list.data;
  const extra = useMemo(() => (samePage ? paged.items : []), [samePage, paged.items]);
  const next = samePage ? paged.next : list.data?.nextPageToken ?? null;

  useEffect(() => {
    const err = params.get("error");
    if (err) toast.error(ERRORS[err] ?? `Couldn't connect (${err})`);
    else if (params.get("connected")) toast.success(params.get("nofolder") ? "Connected, but no folder named “Memories” was found in My Drive" : "Connected to Google Drive");
  }, [params]);

  const all = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const folders = all.filter((i) => i.kind === "folder");
  const files = all.filter((i) => i.kind !== "folder" && i.kind !== "other" && (kind === "all" || i.kind === kind) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));
  const shownFolders = folders.filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()));

  const groups = useMemo(() => {
    const out: { label: string; items: { it: LibraryItem; i: number }[] }[] = [];
    files.forEach((it, i) => {
      const label = monthLabel(it.modified);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push({ it, i });
      else out.push({ label, items: [{ it, i }] });
    });
    return out;
  }, [files]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setMore(true);
    try {
      const r = await api.libraryItems(folder, next);
      setPaged({ base: list.data, items: [...extra, ...r.items], next: r.nextPageToken });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load more");
    } finally {
      setMore(false);
    }
  }, [folder, next, list.data, extra]);

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? Your files in Drive are not touched.")) return;
    try {
      await api.libraryDisconnect();
      toast.success("Disconnected");
      status.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    }
  }

  // viewer navigation over the visible files
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i == null ? i : Math.min(files.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i == null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, files.length]);

  const current = open != null ? files[open] : null;
  const zoomed = !!current && current.kind === "image" && zoomId === current.id;

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[data-current="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [open]);

  if (status.loading && !status.data) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (!status.data?.configured)
    return (
      <div className="space-y-2">
        <h1 className="text-[26px] font-medium tracking-tight">Library</h1>
        <p className="text-[14px] text-muted-foreground">Google isn&rsquo;t set up on the server yet. The client secret still needs to be added (see the setup notes).</p>
      </div>
    );

  if (!connected)
    return (
      <div className="space-y-4">
        <h1 className="text-[26px] font-medium tracking-tight">Library</h1>
        <p className="max-w-xl text-[14px] text-muted-foreground">
          Show the photos and videos from your Google Drive folder named <b>Memories</b>. This only reads: nothing is copied or changed, and files outside that folder can&rsquo;t be opened from here.
        </p>
        {status.data?.connected && !status.data.folderId && <p className="text-sm text-destructive">Connected, but no folder named “Memories” was found at the top of My Drive. Create it in Drive, then connect again.</p>}
        <Button asChild>
          <a href="/api/library/google/connect">{status.data?.connected ? "Connect again" : "Connect Google Drive"}</a>
        </Button>
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
          <button className="underline-offset-2 hover:underline" onClick={() => setFolder(undefined)}>
            {status.data?.folderName ?? "Memories"}
          </button>
          {list.data && !list.data.folder.isRoot && (
            <>
              <ChevronRight className="size-3.5" />
              <span className="text-foreground">{list.data.folder.name}</span>
            </>
          )}
        </div>
        <h1 className="text-[26px] font-medium tracking-tight">Library</h1>
        <p className="mt-1 flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-600" /> Connected to Google Drive · read only
          <button className="ml-2 underline-offset-2 hover:underline" onClick={disconnect}>
            Disconnect
          </button>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this folder" className="h-9 w-full rounded-lg border bg-card pl-9 pr-3 text-[14px] outline-none focus:border-foreground/40" />
        </div>
        <div className="flex overflow-hidden rounded-lg border bg-card">
          {(["grid", "list"] as const).map((v) => (
            <button key={v} aria-label={v} onClick={() => setView(v)} className={cn("px-3 py-2 text-muted-foreground", view === v && "bg-muted text-foreground")}>
              {v === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border bg-card px-3 py-1 text-[13px] text-muted-foreground", kind === k && "border-foreground bg-foreground text-background")}>
            {label}
          </button>
        ))}
      </div>

      {list.error && <p className="text-sm text-destructive">{list.error === "reconnect_needed" ? "Google access expired. Disconnect and connect again." : `Couldn't load Drive (${list.error})`}</p>}

      {list.loading && !list.data ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : (
        <>
          {shownFolders.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {shownFolders.map((f) => (
                <FolderCard key={f.id} folder={f} onOpen={() => setFolder(f.id)} />
              ))}
            </div>
          )}

          {groups.map((g) => (
            <section key={g.label} className="space-y-3">
              <h2 className="pt-2 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h2>
              {view === "grid" ? (
                <div className="columns-[190px] gap-3.5">
                  {g.items.map(({ it, i }) => (
                    <button key={it.id} onClick={() => setOpen(i)} className="group relative mb-3.5 block w-full break-inside-avoid overflow-hidden rounded-lg border bg-card text-left">
                      <Thumb item={it} className="transition group-hover:scale-[1.02]" />
                      {it.kind === "video" && (
                        <>
                          <span className="absolute left-1/2 top-[calc(50%-14px)] grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white">
                            <Play className="size-4 fill-current" />
                          </span>
                          {it.duration != null && <span className="absolute right-2 top-2 rounded bg-black/65 px-1.5 text-[11px] text-white">{fmtDur(it.duration)}</span>}
                        </>
                      )}
                      <div className="flex justify-between gap-2 px-3 py-2 text-[12.5px] text-muted-foreground">
                        <span className="truncate text-foreground">{it.name}</span>
                        <span className="shrink-0">{fmtDate(it.modified)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {g.items.map(({ it, i }) => (
                    <button key={it.id} onClick={() => setOpen(i)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-2 text-left">
                      <Thumb item={it} className="size-12 rounded-md" />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{it.name}</span>
                      <span className="shrink-0 text-[12.5px] text-muted-foreground">
                        {it.kind === "video" ? fmtDur(it.duration) : fmtSize(it.size)} · {fmtDate(it.modified)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}

          {files.length === 0 && shownFolders.length === 0 && <p className="py-8 text-center text-[14px] text-muted-foreground">Nothing here{q || kind !== "all" ? " matches" : " yet"}.</p>}
          {next && (
            <div className="text-center">
              <Button variant="outline" onClick={loadMore} disabled={more}>
                {more && <Loader2 className="animate-spin" />} Load more
              </Button>
            </div>
          )}
        </>
      )}

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/92" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="flex items-center gap-2 p-3 text-white">
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-[14px] font-medium">{current.name}</p>
              <p className="text-[12.5px] text-white/70">
                {fmtDate(current.modified)}
                {current.size ? ` · ${fmtSize(current.size)}` : ""} · {open! + 1}/{files.length}
              </p>
            </div>
            {current.kind === "image" && (
              <button aria-label={zoomed ? "Zoom out" : "Zoom in"} title={zoomed ? "Zoom out" : "Zoom in"} className="rounded-lg bg-white/15 p-2 hover:bg-white/25" onClick={() => setZoomId(zoomed ? null : current.id)}>
                {zoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
              </button>
            )}
            <a aria-label="Download" title="Download" className="rounded-lg bg-white/15 p-2 hover:bg-white/25" href={`/api/library/file/${current.id}?download=1&n=${encodeURIComponent(current.name)}`}>
              <Download className="size-5" />
            </a>
            {current.link && (
              <a aria-label="Open in Google Drive" title="Open in Google Drive" className="rounded-lg bg-white/15 p-2 hover:bg-white/25" href={current.link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-5" />
              </a>
            )}
            <button aria-label="Close" title="Close" className="rounded-lg bg-white/15 p-2 hover:bg-white/25" onClick={() => setOpen(null)}>
              <X className="size-5" />
            </button>
          </div>

          <div className={cn("relative flex min-h-0 flex-1 justify-center px-4", zoomed ? "items-start overflow-auto" : "items-center")} onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
            {current.kind === "video" ? (
              <video key={current.id} src={`/api/library/file/${current.id}`} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg bg-black" />
            ) : current.kind === "pdf" ? (
              <iframe key={current.id} src={`/api/library/file/${current.id}`} title={current.name} className="h-full w-full max-w-5xl rounded-lg bg-white" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={current.id}
                src={`/api/library/file/${current.id}`}
                alt={current.name}
                onClick={() => setZoomId(zoomed ? null : current.id)}
                className={cn("rounded-lg", zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
                style={zoomed && current.width ? { width: Math.min(current.width, 2400) } : undefined}
              />
            )}
            {open! > 0 && (
              <button aria-label="Previous" className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" onClick={() => setOpen(open! - 1)}>
                <ChevronLeft className="size-6" />
              </button>
            )}
            {open! < files.length - 1 && (
              <button aria-label="Next" className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" onClick={() => setOpen(open! + 1)}>
                <ChevronRight className="size-6" />
              </button>
            )}
          </div>

          <div ref={strip} className="flex gap-2 overflow-x-auto p-3">
            {files.map((f, i) => (
              <button key={f.id} data-current={i === open} onClick={() => setOpen(i)} aria-label={f.name} className={cn("relative size-14 shrink-0 overflow-hidden rounded-md border-2 border-transparent opacity-60 hover:opacity-100", i === open && "border-white opacity-100")}>
                <Thumb item={f} className="size-full" />
                {f.kind === "video" && <Play className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
