"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { formatDay, localDateKey } from "@/lib/time";
import type { Note } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pupu } from "./pupu";

type Draft = { title: string; content: string; note_date: string; pinned: boolean };
const emptyDraft = (): Draft => ({ title: "", content: "", note_date: localDateKey(), pinned: false });

function relative(iso: string) {
  const key = localDateKey(new Date(iso));
  const today = localDateKey();
  if (key === today) return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  return formatDay(key, { month: "short", day: "numeric" });
}

export function NotesView() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  // เปิดบันทึกจากลิงก์ /notes?id=... (คอมโพเนนต์นี้ render ฝั่ง client เท่านั้น)
  const [selectedId, setSelectedId] = useState<string | "new" | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("id"),
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: notes, loading } = useData(() => api.notes(debounced || undefined), [debounced]);
  const selected: Note | undefined = notes?.find((n) => n.id === selectedId);
  const editorOpen = selectedId === "new" || !!selected;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-medium tracking-tight">Notes</h1>
        <Button className="rounded-full px-4" onClick={() => setSelectedId("new")}>
          <Plus /> New note
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        {/* รายการ */}
        <div className={cn("space-y-3", editorOpen && "hidden md:block")}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1">
            {loading && !notes && <div className="h-16 animate-pulse rounded-lg bg-muted" />}
            {notes?.length === 0 && (
              <div className="group/pupu flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
                <Pupu size={56} pose={debounced ? "search" : "sleepy"} className="mb-2" />
                <p>{debounced ? "No notes match your search." : "No notes yet."}</p>
              </div>
            )}
            {notes?.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                className={cn(
                  "block w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-200 hover:bg-muted/60",
                  selectedId === n.id && "bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {n.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relative(n.updated_at)}</span>
                </span>
                {n.content && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.content}</span>}
              </button>
            ))}
          </div>
        </div>

        {editorOpen ? (
          <NoteEditor
            key={selected ? `${selected.id}:${selected.updated_at}` : "new"}
            note={selected ?? null}
            onSaved={(id) => setSelectedId(id)}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <Card className="group/pupu hidden items-center justify-center gap-3 py-20 text-center text-sm text-muted-foreground md:flex">
            <Pupu pose="write" size={96} />
            <p>Pick a note on the left, or start a new one.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  onSaved,
  onClose,
}: {
  note: Note | null;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    note
      ? { title: note.title, content: note.content, note_date: note.note_date ?? "", pinned: note.pinned }
      : emptyDraft(),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = note
    ? draft.title !== note.title ||
      draft.content !== note.content ||
      draft.note_date !== (note.note_date ?? "") ||
      draft.pinned !== note.pinned
    : !!(draft.title.trim() || draft.content.trim());

  async function save() {
    const title = draft.title.trim() || draft.content.trim().split("\n")[0].slice(0, 80);
    if (!title) return toast.error("Add a title or some text first");
    setSaving(true);
    try {
      const payload = { title, content: draft.content, note_date: draft.note_date || null, pinned: draft.pinned };
      if (note) {
        await api.updateNote(note.id, payload);
      } else {
        const n = await api.createNote({ ...payload, note_date: payload.note_date ?? undefined });
        onSaved(n.id);
      }
      toast.success("Note saved");
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the note");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!note) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await api.deleteNote(note.id);
      onClose();
      toast.success("Note deleted");
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the note");
    }
  }

  return (
    <Card className="motion-fade gap-3 px-4 py-4">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to notes" onClick={onClose}>
          <ArrowLeft />
        </Button>
        <Input
          type="date"
          className="h-8 w-auto"
          value={draft.note_date}
          onChange={(e) => setDraft((d) => ({ ...d, note_date: e.target.value }))}
          aria-label="Note date"
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={draft.pinned ? "Unpin note" : "Pin note"}
            title={draft.pinned ? "Unpin note" : "Pin note"}
            onClick={() => setDraft((d) => ({ ...d, pinned: !d.pinned }))}
          >
            {draft.pinned ? <PinOff /> : <Pin />}
          </Button>
          {note && (
            <Button variant="ghost" size={confirmDelete ? "sm" : "icon-sm"} aria-label="Delete note" onClick={remove} className="text-destructive">
              <Trash2 />
              {confirmDelete && "Click again to delete"}
            </Button>
          )}
          <Button size="sm" className="rounded-full px-3" onClick={save} disabled={saving || !dirty}>
            {saving && <Loader2 className="animate-spin" />}
            Save note
          </Button>
        </div>
      </div>
      <Input
        placeholder="Title"
        autoFocus={!note}
        className="h-auto border-0 px-0 text-[22px] font-medium tracking-tight shadow-none focus-visible:ring-0 md:text-[22px] dark:bg-transparent"
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
      />
      <Textarea
        placeholder="Start writing… Markdown works."
        className="min-h-[50dvh] resize-none border-0 px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
        value={draft.content}
        onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (dirty) save();
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        {note && <>Edited {new Date(note.updated_at).toLocaleString("en-US", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}. </>}
        ⌘/Ctrl + S to save.
      </p>
    </Card>
  );
}
