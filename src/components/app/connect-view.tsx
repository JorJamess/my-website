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
      toast.success("คัดลอกแล้ว");
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
    toast.error("เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ — เลือกข้อความไว้ให้แล้ว กด ⌘C หรือ Ctrl+C");
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-1 rounded-lg border bg-muted/40 p-1 pl-3">
        <code ref={codeRef} className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all select-all">
          {show ? value : mask(value, token)}
        </code>
        {token && value.includes(token) && (
          <Button variant="ghost" size="icon-sm" aria-label={show ? "ซ่อน" : "แสดง"} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff /> : <Eye />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="คัดลอก"
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
          เชื่อม Claude ผ่าน MCP เพื่อให้ดูสรุปกำหนดการ ลงงาน และจดบันทึกแทนคุณได้
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && !data.configured && (
        <Card className="border-orange-500/40">
          <CardContent className="flex gap-3 text-sm">
            <ShieldAlert className="size-5 shrink-0 text-orange-500" />
            <p>
              ยังไม่ได้ตั้งค่า <code>MCP_TOKEN</code> (ต้องยาวอย่างน้อย 16 ตัวอักษร) — รัน{" "}
              <code>npx wrangler secret put MCP_TOKEN</code> แล้ว deploy ใหม่
            </p>
          </CardContent>
        </Card>
      )}

      {data?.configured && data.urlWithKey && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Claude.ai / Claude Desktop / มือถือ</CardTitle>
              <CardDescription>ใช้ “Custom connector” — URL นี้มีรหัสลับอยู่ในตัว อย่าแชร์ให้ใคร</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyField label="Connector URL" value={data.urlWithKey} token={data.token} />
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>เปิด Claude → Settings → Connectors</li>
                <li>
                  กด <b>Add custom connector</b> ตั้งชื่อ เช่น “ปฏิทินของฉัน” แล้ววาง URL ด้านบน
                </li>
                <li>ในแชท เปิดใช้ connector จากเมนูเครื่องมือ แล้วลองพิมพ์ “สรุปงานสัปดาห์นี้ให้หน่อย”</li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claude Code</CardTitle>
              <CardDescription>รันคำสั่งนี้ในเทอร์มินัลครั้งเดียว (ใช้ได้ทุกโปรเจกต์ด้วย --scope user)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyField
                label="คำสั่ง"
                value={`claude mcp add --scope user --transport http my-calendar ${data.urlBearer} --header "Authorization: Bearer ${data.token}"`}
                token={data.token}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>เครื่องมือที่ Claude ใช้ได้</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {[
                  ["get_summary", "สรุปวันนี้ / 7 วันข้างหน้า / เลยกำหนด"],
                  ["list_events", "ดูงานในช่วงวันที่"],
                  ["search_events", "ค้นหางาน"],
                  ["create_event", "ลงงานใหม่"],
                  ["update_event", "แก้ไข / ทำเครื่องหมายเสร็จ"],
                  ["delete_event", "ลบงาน"],
                  ["list_notes · get_note", "ดู/อ่านบันทึก"],
                  ["create_note · update_note", "จด/แก้บันทึก"],
                  ["delete_note", "ลบบันทึก"],
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
