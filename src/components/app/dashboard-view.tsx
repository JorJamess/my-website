"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowRight, CalendarCheck, CalendarDays, CalendarRange, NotebookPen, Pin, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { addDaysKey, eventDayRange, formatDay, localDateKey } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "./event-dialog";
import { EventRow } from "./event-row";
import { MoneyCard } from "./money-card";

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Bangkok" }));
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function dayHeading(key: string, today: string) {
  if (key === addDaysKey(today, 1)) return "พรุ่งนี้";
  return formatDay(key, { weekday: "long", day: "numeric", month: "short" });
}

export function DashboardView() {
  const { data, loading, error } = useData(() => api.summary(), []);
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEvent | null }>({ open: false, event: null });
  const openEvent = (event: CalendarEvent | null) => setDialog({ open: true, event });
  const today = data?.today ?? localDateKey();

  const upcomingByDay = new Map<string, CalendarEvent[]>();
  for (const e of data?.upcoming ?? []) {
    const key = eventDayRange(e)[0];
    upcomingByDay.set(key, [...(upcomingByDay.get(key) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{formatDay(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()} 👋</h1>
        </div>
        <Button onClick={() => openEvent(null)}>
          <Plus /> ลงงาน
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CalendarCheck} label="งานวันนี้" value={data?.todayEvents.length} />
        <Stat icon={CalendarRange} label="สัปดาห์นี้" value={data?.counts.thisWeek} hint={data ? `เสร็จ ${data.counts.doneThisWeek}` : undefined} />
        <Stat icon={CalendarDays} label="เดือนนี้" value={data?.counts.thisMonth} />
        <Stat icon={NotebookPen} label="บันทึกทั้งหมด" value={data?.counts.notes} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>วันนี้</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/calendar">
                    เปิดปฏิทิน <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {loading && !data ? (
                <Skeleton />
              ) : data?.todayEvents.length ? (
                <div className="-mx-2">
                  {data.todayEvents.map((e) => (
                    <EventRow key={e.id} event={e} onOpen={openEvent} />
                  ))}
                </div>
              ) : (
                <Empty text="วันนี้ว่าง ไม่มีงาน" />
              )}
            </CardContent>
          </Card>

          {!!data?.overdue.length && (
            <Card className="border-orange-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <AlertCircle className="size-4" /> เลยกำหนด ยังไม่เสร็จ
                </CardTitle>
              </CardHeader>
              <CardContent className="-mx-2">
                {data.overdue.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    onOpen={openEvent}
                    prefix={<span>{formatDay(eventDayRange(e)[0], { day: "numeric", month: "short" })}</span>}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>7 วันข้างหน้า</CardTitle>
            </CardHeader>
            <CardContent>
              {loading && !data ? (
                <Skeleton />
              ) : upcomingByDay.size ? (
                <div className="space-y-4">
                  {[...upcomingByDay].map(([key, events]) => (
                    <div key={key}>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{dayHeading(key, today)}</p>
                      <div className="-mx-2">
                        {events.map((e) => (
                          <EventRow key={e.id} event={e} onOpen={openEvent} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="ยังไม่มีงานในอีก 7 วัน" />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <MoneyCard />
          <QuickNote today={today} />
          <Card>
            <CardHeader>
              <CardTitle>บันทึกล่าสุด</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/notes">
                    ทั้งหมด <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-1">
              {data?.recentNotes.length ? (
                data.recentNotes.map((n) => (
                  <Link key={n.id} href={`/notes?id=${n.id}`} className="-mx-2 block rounded-lg px-2 py-2 hover:bg-muted/60">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {n.pinned && <Pin className="size-3 shrink-0" />}
                      {n.title}
                    </p>
                    {n.content && <p className="line-clamp-2 text-xs text-muted-foreground">{n.content}</p>}
                  </Link>
                ))
              ) : (
                <Empty text="ยังไม่มีบันทึก" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <EventDialog
        open={dialog.open}
        event={dialog.event}
        defaultDate={today}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}

function QuickNote({ today }: { today: string }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim() || content.trim().split("\n")[0].slice(0, 80);
    if (!t) return;
    setSaving(true);
    try {
      await api.createNote({ title: t, content, note_date: today });
      setTitle("");
      setContent("");
      toast.success("จดบันทึกแล้ว");
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>จดด่วน</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-2">
          <Input placeholder="หัวข้อ (ไม่บังคับ)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            placeholder="จดอะไรไว้หน่อย…"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(e);
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter เพื่อบันทึก</span>
            <Button type="submit" size="sm" disabled={saving || (!title.trim() && !content.trim())}>
              {saving && <Loader2 className="animate-spin" />}
              บันทึก
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value ?? "–"}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
