"use client";

import { useEffect, useState } from "react";
import { Download, History, Loader2, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged, UNAUTHORIZED_EVENT } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pupu, PUPU_POSE_LABELS, PUPU_POSES } from "./pupu";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
const TABLE_LABELS: Record<string, string> = { events: "events", notes: "notes", todos: "to-dos", habits: "habits", habit_checkins: "check-ins", categories: "categories", goals: "goals", milestones: "milestones", goal_links: "links", event_exceptions: "skipped repeats" };
const REASONS: Record<string, string> = { weekly: "Weekly", manual: "Manual", "pre-restore": "Before a restore" };
const countsText = (b: { counts?: Record<string, number>; events?: number; notes?: number }) => {
  const c = b.counts ?? { events: b.events ?? 0, notes: b.notes ?? 0 };
  return Object.entries(c)
    .map(([t, n]) => `${n} ${TABLE_LABELS[t] ?? t}`)
    .join(", ");
};
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-12">
      <h1 className="text-[26px] font-medium tracking-tight">Settings</h1>
      <Visits />
      <Backups />
      <Security />
      <InstallApp />
      <MeetPupu />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-medium">{title}</h2>
      <p className="mt-1 text-[14.5px] text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Backups() {
  const { data, loading, error, reload } = useData(() => api.backups(), []);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function backupNow() {
    setSaving(true);
    try {
      await api.backupNow();
      toast.success("Backup saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the backup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Backups"
      description="Your events, notes, to-dos, habits and goals are backed up every Monday at 03:00 Thailand time. Each backup is kept for 8 weeks."
    >
      <div className="flex flex-wrap gap-2">
        <Button className="px-4" onClick={backupNow} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Back up now
        </Button>
        <Button variant="outline" className="px-4" asChild>
          <a href="/api/backups/download" download>
            <Download /> Download current data
          </a>
        </Button>
      </div>

      <div className="mt-5">
        {loading && !data ? (
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        ) : error ? (
          <div className="flex items-center gap-3">
            <Pupu pose="oops" size={52} />
            <p className="text-sm text-destructive">Couldn&rsquo;t load backups. {error}.</p>
          </div>
        ) : data?.length ? (
          <ul>
            {data.map((b) => (
              <li key={b.key} className="flex items-center gap-3 border-t py-3 text-[14.5px]">
                <div className="min-w-0 flex-1">
                  <p>{when(b.created_at)}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {REASONS[b.reason] ?? b.reason}, {countsText(b)}, {size(b.bytes)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRestoring(b.key)}>
                  <History /> Restore
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/api/backups/download?key=${encodeURIComponent(b.key)}`} download>
                    <Download /> Download
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14.5px] text-muted-foreground">No saved backups yet. The first weekly one runs next Monday.</p>
        )}
      </div>
      <RestoreDialog key={restoring ?? "closed"} backupKey={restoring} onClose={() => setRestoring(null)} onDone={reload} />
    </Section>
  );
}

function RestoreDialog({ backupKey, onClose, onDone }: { backupKey: string | null; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<{ table: string; current: number; incoming: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!backupKey) return;
    let live = true;
    api
      .restorePreview(backupKey)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't read the backup"));
    return () => {
      live = false;
    };
  }, [backupKey]);

  async function restore() {
    if (!backupKey) return;
    setBusy(true);
    try {
      await api.restore(backupKey);
      toast.success("Backup restored");
      notifyChanged();
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't restore the backup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!backupKey} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restore this backup?</DialogTitle>
          <DialogDescription>
            This replaces your current data with the backup. A copy of what you have now is saved first, so you can undo it from this list.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}.</p>
        ) : !preview ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : (
          <ul className="space-y-1 text-[14.5px]">
            {preview.map((p) => (
              <li key={p.table} className="flex justify-between border-t py-2 first:border-t-0">
                <span className="capitalize">{TABLE_LABELS[p.table] ?? p.table}</span>
                <span className="tabular-nums text-muted-foreground">
                  {p.current} now &rarr; <span className="font-medium text-foreground">{p.incoming}</span> after
                </span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={restore} disabled={!preview || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Security() {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function logoutEverywhere() {
    if (!confirm) return setConfirm(true);
    setBusy(true);
    try {
      await api.logoutEverywhere();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); // back to the login screen
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log out everywhere");
      setBusy(false);
    }
  }

  return (
    <Section
      title="Security"
      description="Lost a device or used a shared computer? Log out everywhere to end every session, including this one."
    >
      <Button variant="outline" className="px-4" onClick={logoutEverywhere} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {confirm ? "Click again to log out everywhere" : "Log out of all devices"}
      </Button>
    </Section>
  );
}

function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  // หน้านี้ render ฝั่ง client เท่านั้น (อยู่หลัง login)
  const [installed, setInstalled] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return (
    <Section title="Install as an app" description="Add jameswebpupu to your home screen so it opens full screen, like a regular app.">
      {installed ? (
        <p className="text-[14.5px] text-positive">Installed on this device.</p>
      ) : prompt ? (
        <Button
          className="px-4"
          onClick={async () => {
            await prompt.prompt();
            setPrompt(null);
          }}
        >
          <Smartphone /> Install app
        </Button>
      ) : (
        <ul className="space-y-2 text-[14.5px] text-muted-foreground">
          <li>
            <span className="text-foreground">iPhone or iPad:</span> open this site in Safari, tap{" "}
            <Share className="inline size-4 -translate-y-px" aria-label="Share" />, then Add to Home Screen.
          </li>
          <li>
            <span className="text-foreground">Android:</span> open the Chrome menu, then Add to Home screen or Install app.
          </li>
          <li>
            <span className="text-foreground">Mac or PC:</span> in Chrome or Edge, use the install icon in the address bar.
          </li>
        </ul>
      )}
    </Section>
  );
}

function MeetPupu() {
  return (
    <Section title="Meet Pupu" description="The mochi bunny who keeps your planner. Hover over Pupu to say hi.">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PUPU_POSES.map((pose) => (
          <li
            key={pose}
            className="group/pupu flex flex-col items-center gap-1.5 rounded-[14px] border bg-card px-3 pt-4 pb-3 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <Pupu pose={pose} size={88} day={pose === "happy" ? new Date().getDate() : undefined} />
            <span className="text-[13px] text-muted-foreground">{PUPU_POSE_LABELS[pose]}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Visits() {
  const { data, error } = useData(() => api.stats(14), []);
  const max = Math.max(1, ...(data?.byDay.map((d) => d.views) ?? [1]));
  return (
    <Section
      title="Portfolio visits"
      description="Page views of the public portfolio over the last 14 days. No cookies, no IP addresses; bots and your own logged-in visits aren’t counted."
    >
      {error ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load visits. {error}.</p>
      ) : !data ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : data.total === 0 ? (
        <p className="text-[14.5px] text-muted-foreground">No visits yet. They show up here once someone opens the portfolio.</p>
      ) : (
        <div className="space-y-5">
          <p className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">
            {data.total} <span className="text-[15px] font-normal text-muted-foreground">views, {data.byLang.en} English and {data.byLang.th} Thai</span>
          </p>
          <div className="flex h-16 items-end gap-1" role="img" aria-label="Views per day">
            {data.byDay.map((d) => (
              <div key={d.day} className="flex-1 rounded-sm bg-brand" style={{ height: `${Math.max(6, (d.views / max) * 100)}%` }} title={`${d.day}: ${d.views}`} />
            ))}
          </div>
          <div className="grid gap-6 text-[14.5px] sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Where they came from</p>
              {data.topRefs.length ? (
                <ul>{data.topRefs.map((r) => (<li key={r.ref} className="flex justify-between border-t py-1.5"><span>{r.ref}</span><span className="tabular-nums text-muted-foreground">{r.views}</span></li>))}</ul>
              ) : (
                <p className="text-muted-foreground">Mostly direct links so far.</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Countries</p>
              {data.topCountries.length ? (
                <ul>{data.topCountries.map((c) => (<li key={c.country} className="flex justify-between border-t py-1.5"><span>{c.country}</span><span className="tabular-nums text-muted-foreground">{c.views}</span></li>))}</ul>
              ) : (
                <p className="text-muted-foreground">No country data yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
