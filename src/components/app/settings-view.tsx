"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { Button } from "@/components/ui/button";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-12">
      <h1 className="text-[26px] font-medium tracking-tight">Settings</h1>
      <Backups />
      <InstallApp />
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
          <p className="text-sm text-destructive">Couldn&rsquo;t load backups. {error}.</p>
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
