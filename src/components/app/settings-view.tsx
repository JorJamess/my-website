"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { Button } from "@/components/ui/button";
import { Pupu, PUPU_POSE_LABELS, PUPU_POSES } from "./pupu";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-12">
      <h1 className="text-[26px] font-medium tracking-tight">Settings</h1>
      <Visits />
      <Backups />
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
      description="Your events and notes are backed up every Monday at 03:00 Thailand time. Each backup is kept for 8 weeks."
    >
      <div className="flex flex-wrap gap-2">
        <Button className="rounded-full px-4" onClick={backupNow} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Back up now
        </Button>
        <Button variant="outline" className="rounded-full px-4" asChild>
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
                    {b.reason === "weekly" ? "Weekly" : "Manual"}, {b.events} events, {b.notes} notes, {size(b.bytes)}
                  </p>
                </div>
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
          className="rounded-full px-4"
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
