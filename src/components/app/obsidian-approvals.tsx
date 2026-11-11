"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { cn } from "@/lib/utils";

const OP_LABEL: Record<string, string> = { create_note: "Create note", edit_note: "Edit note", rename_note: "Rename note", move_note: "Move note", delete_note: "Delete note", create_folder: "Create folder", rename_folder: "Rename folder", move_folder: "Move folder", delete_folder: "Delete folder" };

function life(seconds: number) {
  const d = seconds / 86400;
  return d >= 1 ? `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}` : `${Math.round(seconds / 3600)} hours`;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });

/** The exact change Claude proposed: path, full text or diff. Nothing here is saved in the activity log. */
export function VaultReview({ pendingId }: { pendingId: string }) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useData(() => (open ? api.obsidianPreview(pendingId) : Promise.resolve(null)), [open, pendingId]);
  const p = data?.payload as { path?: string; new_path?: string; content?: string; new_content?: string; impact?: { synced_notes: number; synced_pdfs: number; synced_note_paths: string[]; more_synced_notes: number } } | null | undefined;

  return (
    <div className="mt-2 ml-6">
      <button type="button" className="inline-flex items-center gap-1 text-[13.5px] text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} /> {open ? "Hide the exact change" : "Review the exact change"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border bg-background p-3 text-[13.5px]">
          {loading && !data ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="text-destructive">{error}</p>
          ) : data ? (
            <>
              <p className="font-medium">{OP_LABEL[data.op] ?? data.op}</p>
              {p?.path && (
                <p className="font-mono text-[12.5px] break-all">
                  {p.path}
                  {p.new_path ? ` → ${p.new_path}` : ""}
                </p>
              )}
              {data.secret_findings > 0 && <p className="text-amber-700 dark:text-amber-400">This text may contain a secret. It will be created on your Mac, but it will not be synced until it passes the scan or you approve the finding.</p>}
              {data.diff && (
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[12.5px] whitespace-pre-wrap">
                  {data.diff.split("\n").map((l, i) => (
                    <span key={i} className={cn("block", l.startsWith("+") && "text-positive", l.startsWith("-") && "text-destructive")}>
                      {l || " "}
                    </span>
                  ))}
                </pre>
              )}
              {(p?.content ?? (data.diff ? undefined : p?.new_content)) !== undefined && (
                <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[12.5px] whitespace-pre-wrap">{p?.content ?? p?.new_content}</pre>
              )}
              {p?.impact && (
                <div>
                  <p>
                    {p.impact.synced_notes} synced note{p.impact.synced_notes === 1 ? "" : "s"} and {p.impact.synced_pdfs} PDF{p.impact.synced_pdfs === 1 ? "" : "s"} are affected:
                  </p>
                  <ul className="mt-1 list-disc pl-5 font-mono text-[12.5px] break-all">
                    {p.impact.synced_note_paths.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  {p.impact.more_synced_notes > 0 && <p className="mt-1">…and {p.impact.more_synced_notes} more</p>}
                  <p className="mt-2 text-muted-foreground">Files in this folder that you haven&rsquo;t shared are moved too. Claude can&rsquo;t see them; your Mac reports how many it moved after it applies this.</p>
                </div>
              )}
              <p className="text-muted-foreground">
                After you approve, your Mac applies this when it is online. It waits up to {life(data.ttl_seconds)} from the moment you approve, then it expires. Existing notes are backed up first, deletes go to the Obsidian trash, and nothing is overwritten.
              </p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** What is waiting for the Mac, and what needs a look (a conflict or a failure). */
export function VaultQueues({ refreshKey }: { refreshKey: unknown }) {
  const { data } = useData(() => api.obsidianCommands(), [refreshKey]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const cmds = data ?? [];
  const waiting = cmds.filter((c) => c.status === "approved" || c.status === "claimed");
  const sevenDays = now - 7 * 86_400_000;
  const attention = cmds.filter((c) => (c.status === "conflict" || c.status === "failed" || c.status === "expired") && new Date(c.finished_at ?? c.created_at).getTime() > sevenDays);
  if (!waiting.length && !attention.length) return null;
  return (
    <section aria-label="Obsidian changes" className="space-y-4">
      {waiting.length > 0 && (
        <div>
          <h2 className="mb-1 text-xs text-muted-foreground">Approved, waiting for your Mac</h2>
          {waiting.map((c) => (
            <div key={c.id} className="border-t py-2.5 text-[14px]">
              <p className="break-words">{c.summary ?? OP_LABEL[c.op]}</p>
              <p className="text-xs text-muted-foreground">
                {c.status === "claimed" ? "Your Mac is applying it" : `Applies when your Mac is online · expires ${when(c.expires_at)}`}
              </p>
            </div>
          ))}
        </div>
      )}
      {attention.length > 0 && (
        <div>
          <h2 className="mb-1 text-xs text-muted-foreground">Needs a look</h2>
          {attention.map((c) => (
            <div key={c.id} className="border-t py-2.5 text-[14px]">
              <p className="break-words">{c.summary ?? OP_LABEL[c.op]}</p>
              <p className="text-xs text-muted-foreground">
                {c.status === "conflict" ? "Not applied: the note changed on your Mac after you approved. Your version was kept. Ask Claude to propose it again." : c.status === "expired" ? "Expired before your Mac could apply it. Ask Claude again." : `Not applied: ${c.result ?? "something went wrong"}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

