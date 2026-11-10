"use client";

import { useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TOPIC: Record<string, string> = { internship: "Internship", freelance: "Freelance", other: "Other" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** ข้อความจากฟอร์มติดต่อบนหน้า Portfolio — ซ่อนเมื่อยังไม่เคยมีข้อความ */
export function MessagesCard() {
  const { data } = useData(() => api.messages().catch(() => null), []);
  const [open, setOpen] = useState<string | null>(null);
  if (!data || data.messages.length === 0) return null;
  const shown = data.messages.slice(0, 5);

  async function toggle(id: string, read: boolean) {
    setOpen((o) => (o === id ? null : id));
    if (!read) {
      await api.markMessage(id, true).catch(() => {});
      notifyChanged();
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteMessage(id);
      toast.success("Message deleted");
      notifyChanged();
    } catch {
      toast.error("Couldn't delete the message");
    }
  }

  return (
    <div>
      <h2 className="mb-3.5 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        Messages
        {data.unread > 0 && (
          <span className="rounded-full bg-brand px-1.5 py-px text-[11px] text-white tabular-nums">{data.unread} new</span>
        )}
      </h2>
      <ul>
        {shown.map((m) => (
          <li key={m.id} className="border-t">
            <button type="button" onClick={() => toggle(m.id, m.read)} className="flex w-full items-start gap-2.5 py-2.5 text-left">
              <Mail className={cn("mt-0.5 size-4 shrink-0", m.read ? "text-muted-foreground" : "text-brand")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("truncate text-[15px]", !m.read && "font-medium")}>{m.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{TOPIC[m.topic] ?? m.topic}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{when(m.created_at)}</span>
                </span>
                <span className={cn("block text-[13.5px] text-muted-foreground", open === m.id ? "whitespace-pre-wrap" : "line-clamp-1")}>
                  {m.body}
                </span>
              </span>
            </button>
            {open === m.id && (
              <div className="motion-fade flex items-center gap-2 pb-3 pl-6.5">
                <Button size="sm" className="px-3" asChild>
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message")}`}>Reply to {m.email}</a>
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete message" onClick={() => remove(m.id)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
