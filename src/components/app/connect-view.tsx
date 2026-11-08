"use client";

import { useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function mask(s: string, token: string | null) {
  return token ? s.replace(token, `${token.slice(0, 4)}${"•".repeat(16)}`) : s;
}

/** คัดลอกข้อความ: ลอง Clipboard API ก่อน ถ้าเบราว์เซอร์ไม่อนุญาตใช้วิธี execCommand แทน */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function CopyField({ label, value, token }: { label: string; value: string; token: string | null }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  async function copy() {
    if (await copyText(value)) {
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
      return;
    }
    // คัดลอกอัตโนมัติไม่ได้ → แสดงข้อความเต็มและเลือกไว้ให้กด ⌘C / Ctrl+C เอง
    setShow(true);
    requestAnimationFrame(() => {
      if (!codeRef.current) return;
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    toast.error("Your browser blocked copying. The text is selected, so press ⌘C or Ctrl+C.");
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-1 rounded-lg border bg-muted/40 p-1 pl-3">
        <code ref={codeRef} className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all select-all">
          {show ? value : mask(value, token)}
        </code>
        {token && value.includes(token) && (
          <Button variant="ghost" size="icon-sm" aria-label={show ? "Hide" : "Show"} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff /> : <Eye />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy"
          onClick={copy}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function ConnectView() {
  const { data, error } = useData(() => api.connect(), []);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-[26px] font-medium tracking-tight">Claude</h1>
        <p className="text-sm text-muted-foreground">
          Connect Claude over MCP so it can read your schedule, add events and write notes for you.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && !data.configured && (
        <Card className="border-orange-500/40">
          <CardContent className="flex gap-3 text-sm">
            <ShieldAlert className="size-5 shrink-0 text-orange-500" />
            <p>
              <code>MCP_TOKEN</code> isn’t set (it needs at least 16 characters). Run{" "}
              <code>npx wrangler secret put MCP_TOKEN</code>, then deploy again.
            </p>
          </CardContent>
        </Card>
      )}

      {data?.configured && data.urlWithKey && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Claude.ai, desktop and mobile</CardTitle>
              <CardDescription>Add it as a custom connector. This URL contains your secret key, so don’t share it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyField label="Connector URL" value={data.urlWithKey} token={data.token} />
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>In Claude, open Settings, then Connectors.</li>
                <li>
                  Choose <b>Add custom connector</b>, name it, and paste the URL above.
                </li>
                <li>Turn the connector on in a chat and ask “What’s on this week?”</li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claude Code</CardTitle>
              <CardDescription>Run this once in a terminal. --scope user makes it work in every project.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyField
                label="Command"
                value={`claude mcp add --scope user --transport http my-calendar ${data.urlBearer} --header "Authorization: Bearer ${data.token}"`}
                token={data.token}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What Claude can do</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {[
                  ["get_summary", "Today, the next 7 days and overdue events"],
                  ["list_events", "Events in a date range"],
                  ["search_events", "Search events"],
                  ["create_event", "Add an event"],
                  ["update_event", "Edit an event or mark it done"],
                  ["delete_event", "Delete an event"],
                  ["list_notes, get_note", "Browse and read notes"],
                  ["create_note, update_note", "Write and edit notes"],
                  ["delete_note", "Delete a note"],
                ].map(([name, desc]) => (
                  <li key={name}>
                    <code className="text-xs">{name}</code> <span className="text-muted-foreground">— {desc}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
