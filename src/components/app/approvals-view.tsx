"use client";

import { useState } from "react";
import { Check, Clock, ListChecks, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import type { ActionRisk, PendingAction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pupu } from "./pupu";

const ICON: Record<ActionRisk, typeof Trash2> = { delete: Trash2, edit: ListChecks, link: ListChecks };

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function ApprovalsView() {
  const { data, loading, error } = useData(() => api.approvals(), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(p: PendingAction, decision: "approve" | "reject") {
    setBusy(p.id);
    try {
      const r = await api.decideApproval(p.id, decision);
      if (r.status === "failed") toast.error(r.note ? `Couldn't apply it: ${r.note}` : "Couldn't apply it");
      else toast.success(decision === "approve" ? "Approved and done" : "Rejected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That request is no longer waiting");
    } finally {
      setBusy(null);
      notifyChanged();
    }
  }

  const pending = data?.pending ?? [];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[26px] font-medium tracking-tight">Approvals</h1>
          {pending.length > 0 && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs">{pending.length} waiting</span>}
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">Claude asked to make these changes. Nothing happens until you say yes. Requests expire after 7 days.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !data ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : pending.length === 0 ? (
        <div className="group/pupu flex items-center gap-3 py-4">
          <Pupu size={56} pose="happy" />
          <p className="text-[15px] text-muted-foreground">Nothing is waiting. Claude creates things right away, and asks first before it deletes, edits or links.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {pending.map((p) => {
            const Icon = ICON[p.risk];
            return (
              <li key={p.id} className="rounded-lg border bg-card p-3.5">
                <div className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", p.risk === "delete" ? "text-destructive" : "text-muted-foreground")} strokeWidth={1.8} />
                  <p className="min-w-0 flex-1 text-[15px] font-medium break-words">{p.summary}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(p.created_at)}</span>
                </div>
                {p.risk === "delete" && <p className="mt-1 ml-6 text-[13px] text-muted-foreground">This can&rsquo;t be undone.</p>}
                <div className="mt-3 ml-6 flex gap-2">
                  <Button size="sm" className="px-3" disabled={busy === p.id} onClick={() => decide(p, "approve")}>
                    {busy === p.id && <Loader2 className="animate-spin" />}
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="px-3" disabled={busy === p.id} onClick={() => decide(p, "reject")}>
                    Reject
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-label="Recent activity">
        <h2 className="mb-1 text-xs text-muted-foreground">Recent activity</h2>
        {data?.audit.length === 0 && <p className="border-t py-3 text-sm text-muted-foreground">Nothing yet. Changes Claude makes will be listed here.</p>}
        {data?.audit.map((a) => (
          <div key={a.id} className="flex items-start gap-2 border-t py-2.5 text-[14px]">
            {!a.ok ? <X className="mt-0.5 size-4 shrink-0 text-destructive" /> : a.summary.startsWith("Asked to") ? <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Check className="mt-0.5 size-4 shrink-0 text-positive" />}
            <span className="min-w-0 flex-1 break-words">{a.summary}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {a.actor === "claude" ? "Claude" : "You"} · {ago(a.at)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
