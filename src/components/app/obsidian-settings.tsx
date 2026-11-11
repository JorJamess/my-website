"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Current time that updates every 30 seconds (components must not read the clock while rendering). */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Pill = "ok" | "warn" | "bad" | "plain";
const PILL: Record<Pill, string> = { ok: "text-positive border-positive/40", warn: "text-amber-700 border-amber-600/40 dark:text-amber-400", bad: "text-destructive border-destructive/40", plain: "text-muted-foreground border-border" };
function StatusPill({ tone, children }: { tone: Pill; children: React.ReactNode }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs", PILL[tone])}>{children}</span>;
}

const DOC_STATUS: Record<string, { label: string; tone: Pill }> = {
  synced: { label: "synced", tone: "ok" },
  syncing: { label: "syncing", tone: "plain" },
  pending: { label: "pending", tone: "plain" },
  no_text: { label: "no text", tone: "warn" },
  blocked_secret: { label: "held back: secret", tone: "warn" },
  blocked_revoked: { label: "revoked", tone: "bad" },
  failed: { label: "failed", tone: "bad" },
  conflict: { label: "conflict", tone: "warn" },
};

type SyncRow = { device_id: string; status: string; last_success_at: string | null; last_error: string | null; details: string };
type Device = { id: string; name: string; vault_name: string | null; status: string; paused: boolean; last_seen_at: string | null; sync_requested_at: string | null };

export function ObsidianSettings() {
  const now = useNow();
  const status = useData(() => api.obsidianStatus(), []);
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadAll = async () => {
    await status.reload();
    notifyChanged();
  };
  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  const s = status.data;
  const devices = ((s?.devices ?? []) as Device[]).filter((d) => d.status === "active");
  const device = devices[0];
  const sync = (s?.sync ?? []) as SyncRow[];
  const st = sync.find((x) => x.device_id === device?.id);
  let details: Record<string, string | number> = {};
  try {
    details = JSON.parse(st?.details ?? "{}");
  } catch {}
  const count = (statusName: string, kind?: string) => (s?.documents ?? []).filter((d) => d.status === statusName && (!kind || d.kind === kind)).reduce((a, d) => a + d.n, 0);
  const lastSeenMins = device?.last_seen_at ? (now - new Date(device.last_seen_at).getTime()) / 60_000 : Infinity;
  const online = lastSeenMins < 8; // the Mac checks in every 15 s but LifeOS only records it every 5 minutes
  const waiting = (s?.commands ?? []).filter((c) => c.status === "approved" || c.status === "claimed").reduce((a, c) => a + c.n, 0);

  return (
    <section>
      <h2 className="text-[17px] font-medium">Obsidian</h2>
      <p className="mt-1 text-[14.5px] text-muted-foreground">
        Lets Claude search and read the notes you chose to share, even when your Mac is off. Only notes marked <code className="rounded bg-muted px-1 text-[13px]">lifeos_sync: true</code> are copied here. Your vault stays on your Mac.
      </p>

      <div className="mt-4 space-y-4">
        {status.loading && !s ? (
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
        ) : status.error ? (
          <p className="text-sm text-destructive">Couldn&rsquo;t load Obsidian status. {status.error}.</p>
        ) : !device ? (
          <PairCard onDone={reloadAll} approvalsConfigured={!!s?.approvals_configured} />
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium break-words">{device.name}</p>
                <p className="text-[13px] text-muted-foreground break-words">Vault “{device.vault_name ?? "?"}” · seen {ago(device.last_seen_at)}</p>
              </div>
              <StatusPill tone={device.paused ? "warn" : online ? "ok" : "plain"}>{device.paused ? "Paused" : online ? "Connected" : "Offline"}</StatusPill>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Synced notes" value={count("synced", "note")} />
              <Stat label="PDFs" value={count("synced", "pdf") + count("no_text", "pdf")} />
              <Stat label="Held back" value={count("blocked_secret") + count("failed") + count("conflict")} warn />
              <Stat label="Waiting for Mac" value={waiting} />
            </dl>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Last sync {ago(st?.last_success_at)} · backup on Mac: local {String(details.backup_local ?? "no result yet")}
              {details.backup_local_at ? ` (${ago(String(details.backup_local_at))})` : ""}, external {String(details.backup_external ?? "not set up")}
              {st?.last_error ? ` · last problem: ${st.last_error}` : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="px-4" disabled={busy === "sync" || device.paused} onClick={() => act("sync", () => api.obsidianDevice(device.id, "sync"), "Asked your Mac to sync")}>
                {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
              </Button>
              <Button variant="outline" className="px-4" disabled={busy === "pause"} onClick={() => act("pause", () => api.obsidianDevice(device.id, device.paused ? "resume" : "pause"))}>
                {device.paused ? "Resume sync" : "Pause sync"}
              </Button>
              <Button variant="outline" className="px-4" asChild>
                <Link href="/app/approvals">Open Approvals</Link>
              </Button>
              <Button
                variant="destructive"
                className="px-4"
                onClick={() => setConfirm({ title: "Revoke this Mac?", body: "It stops syncing at once and has to be paired again. Notes already copied here stay until you revoke them one by one.", action: "Revoke Mac", run: () => api.obsidianDevice(device.id, "revoke") })}
              >
                Revoke this Mac
              </Button>
            </div>
            {device.sync_requested_at && <p className="mt-2 text-[13px] text-muted-foreground">Sync requested {ago(device.sync_requested_at)}; it starts when your Mac next checks in.</p>}
            {!s?.search_ready && <p className="mt-2 text-[13px] text-destructive">Search is closed while the index is rebuilt after a restore.</p>}
            {!s?.approvals_configured && <p className="mt-2 text-[13px] text-destructive">Changes from Claude can&rsquo;t be queued yet: the OBSIDIAN_PAYLOAD_KEY secret isn&rsquo;t set on the server.</p>}
          </div>
        )}

        {device && <PairCard onDone={reloadAll} compact approvalsConfigured={!!s?.approvals_configured} />}
        {device && <Findings busy={busy} act={act} />}
        {device && <Documents busy={busy} act={act} setConfirm={setConfirm} />}

        <p className="text-[13px] text-muted-foreground">
          The Mac checks for approved changes every 15 seconds, about 5,760 requests a day (roughly 6% of the free Workers allowance of 100,000, before your other traffic). Revoking a note deletes its current copy and search entries immediately; Cloudflare may keep database history for up to 7 days, which can&rsquo;t be erased on request.
        </p>
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy === "confirm"}
              onClick={async () => {
                const c = confirm!;
                await act("confirm", c.run, "Done");
                setConfirm(null);
              }}
            >
              {busy === "confirm" && <Loader2 className="animate-spin" />} {confirm?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dd className={cn("text-[24px] leading-tight font-medium tabular-nums", warn && value > 0 && "text-amber-700 dark:text-amber-400")}>{value}</dd>
      <dt className="text-xs text-muted-foreground uppercase">{label}</dt>
    </div>
  );
}

function PairCard({ onDone, compact, approvalsConfigured }: { onDone: () => void; compact?: boolean; approvalsConfigured: boolean }) {
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const left = code ? Math.max(0, Math.round((new Date(code.expires_at).getTime() - now) / 1000)) : 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-[15px] font-medium">{compact ? "Pair another Mac" : "Connect your Mac"}</p>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {compact ? "Make a one-time code (valid 10 minutes)." : "Install the Obsidian Bridge on your Mac, then make a one-time code (valid 10 minutes) and enter it there with"} <code className="rounded bg-muted px-1 text-[13px]">obsidian-bridge pair</code>.
      </p>
      {!approvalsConfigured && !compact && <p className="mt-2 text-[13px] text-muted-foreground">Before you use changes from Claude, set the OBSIDIAN_PAYLOAD_KEY secret on the server.</p>}
      {code && left > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[22px] tracking-[0.2em]" aria-label="Pairing code">{code.code}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.clipboard.writeText(code.code).then(() => toast.success("Copied"), () => toast.error("Couldn't copy"))}
          >
            <Copy /> Copy
          </Button>
          <span className="text-[13px] text-muted-foreground">expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
        </div>
      ) : (
        <Button
          className="mt-3 px-4"
          variant={compact ? "outline" : "default"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setCode(await api.obsidianPair());
              setNow(Date.now());
              onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Couldn't make a code");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="animate-spin" />} Make pairing code
        </Button>
      )}
    </div>
  );
}

type Act = (key: string, fn: () => Promise<unknown>, done?: string) => Promise<void>;

function Findings({ busy, act }: { busy: string | null; act: Act }) {
  const { data, reload } = useData(() => api.obsidianFindings(), []);
  const open = (data ?? []).filter((f) => f.status === "open");
  if (!open.length) return null;
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-[15px] font-medium">Secret warnings</p>
      <p className="mt-1 text-[13.5px] text-muted-foreground">These notes stay on your Mac. Values are never shown here. Approving a finding only covers that exact version of the note; edit the note and it is scanned again.</p>
      <ul className="mt-3">
        {open.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 border-t py-2.5 text-[14.5px] first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="break-words">{f.title}</p>
              <p className="text-[13px] break-words text-muted-foreground">
                {f.kind.replace(/_/g, " ")} · line {f.line} · <span className="font-mono">{f.redacted}</span> · {f.path}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy === `f${f.id}`} onClick={() => act(`f${f.id}`, async () => (await api.obsidianExceptFinding(f.id), reload()), "Approved. It syncs on the next pass")}>
              Approve this finding
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Documents({ busy, act, setConfirm }: { busy: string | null; act: Act; setConfirm: (c: { title: string; body: string; action: string; run: () => Promise<unknown> }) => void }) {
  const { data, loading, reload } = useData(() => api.obsidianDocuments(), []);
  const [all, setAll] = useState(false);
  const docs = data ?? [];
  const shown = all ? docs : docs.slice(0, 12);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-medium">Shared with Claude</p>
        <Button variant="ghost" size="sm" onClick={() => reload()}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">Only notes you marked appear here. Revoke removes one from search and reading right away, even if your Mac is off.</p>
      {loading && !data ? (
        <div className="mt-3 h-12 animate-pulse rounded bg-muted" />
      ) : !docs.length ? (
        <p className="mt-3 text-[14.5px] text-muted-foreground">Nothing synced yet.</p>
      ) : (
        <ul className="mt-3">
          {shown.map((d) => {
            const s = DOC_STATUS[d.status] ?? { label: d.status, tone: "plain" as Pill };
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-t py-2.5 text-[14.5px] first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="break-words">
                    {d.title} {d.kind === "pdf" && <span className="ml-1 rounded bg-muted px-1.5 text-xs text-muted-foreground">PDF</span>}
                  </p>
                  <p className="font-mono text-[12.5px] break-all text-muted-foreground">{d.path}</p>
                </div>
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
                {d.status === "blocked_revoked" ? (
                  <Button variant="outline" size="sm" disabled={busy === `r${d.id}`} onClick={() => act(`r${d.id}`, async () => (await api.obsidianReenable(d.id), reload()), "Re-enabled. Your Mac scans it again before uploading")}>
                    Re-enable
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      setConfirm({
                        title: `Revoke “${d.title}”?`,
                        body: "Claude can no longer find or read it, and the copy here is deleted now. It won't come back unless you re-enable it. Your note in Obsidian is not changed, except that your Mac switches its lifeos_sync flag off.",
                        action: "Revoke",
                        run: async () => (await api.obsidianRevoke(d.id), reload()),
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {docs.length > 12 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${docs.length}`}
        </Button>
      )}
    </div>
  );
}
