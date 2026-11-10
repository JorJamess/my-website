"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Bold, CalendarDays, Check, Folder, FolderPlus, Heading2, Italic, Link2, List, ListChecks, Loader2, Pencil, Pin, PinOff, Plus, Search, Tag, Target, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, notifyChanged } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { normalizeTag, normalizeTags } from "@/lib/notes";
import { toggleTaskLine } from "@/lib/markdown";
import { formatDay, localDateKey } from "@/lib/time";
import type { Note, NoteDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownView } from "./markdown-view";
import { NoteLinkPicker } from "./note-link-picker";
import { Pupu } from "./pupu";
import { SelectField } from "./select-field";

type Draft = { title: string; content: string; note_date: string; pinned: boolean; folder: string; tags: string[] };
type Scope = { kind: "all" } | { kind: "pinned" } | { kind: "none" } | { kind: "folder"; name: string } | { kind: "tag"; tag: string };

const toDraft = (n: Note | null): Draft =>
  n
    ? { title: n.title, content: n.content, note_date: n.note_date ?? "", pinned: n.pinned, folder: n.folder?.name ?? "", tags: n.tags }
    : { title: "", content: "", note_date: localDateKey(), pinned: false, folder: "", tags: [] };

function relative(iso: string) {
  const key = localDateKey(new Date(iso));
  if (key === localDateKey()) return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  return formatDay(key, { month: "short", day: "numeric" });
}

export function NotesView() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  // open a note from /notes?id=... (this component only renders on the client)
  const [selectedId, setSelectedId] = useState<string | "new" | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("id"),
  );
  const [editorKey, setEditorKey] = useState(0);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const filter = {
    q: debounced || undefined,
    pinned: scope.kind === "pinned" || undefined,
    folder: scope.kind === "folder" ? scope.name : scope.kind === "none" ? "none" : undefined,
    tag: scope.kind === "tag" ? scope.tag : undefined,
  };
  const { data: notes, loading } = useData(() => api.notes(filter), [debounced, JSON.stringify(scope)]);
  const { data: folders } = useData(() => api.noteFolders(), []);
  const { data: tags } = useData(() => api.noteTags(), []);
  // the selected note may be hidden by the current filter; fetch it directly so the editor never vanishes
  const { data: direct } = useData(() => (selectedId && selectedId !== "new" ? api.note(selectedId).catch(() => null) : Promise.resolve(null)), [selectedId]);
  const selected: Note | null = selectedId && selectedId !== "new" ? (notes?.find((n) => n.id === selectedId) ?? direct ?? null) : null;
  const editorOpen = selectedId === "new" || !!selected;

  const open = (id: string | "new" | null) => {
    setSelectedId(id);
    setEditorKey((k) => k + 1);
  };

  async function addFolder() {
    const name = (newFolder ?? "").trim();
    setNewFolder(null);
    if (!name) return;
    try {
      await api.createNoteFolder(name);
      setScope({ kind: "folder", name });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the folder");
    }
  }
  async function renameFolder(id: string, current: string) {
    const name = window.prompt("Rename folder", current)?.trim();
    if (!name || name === current) return;
    try {
      await api.renameNoteFolder(id, name);
      if (scope.kind === "folder" && scope.name === current) setScope({ kind: "folder", name });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename the folder");
    }
  }
  async function deleteFolder(id: string, name: string, count: number) {
    if (!window.confirm(`Delete the folder "${name}"? Its ${count} note${count === 1 ? "" : "s"} will stay, just without a folder.`)) return;
    try {
      await api.deleteNoteFolder(id);
      if (scope.kind === "folder" && scope.name === name) setScope({ kind: "all" });
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the folder");
    }
  }

  const isScope = (s: Scope) => JSON.stringify(s) === JSON.stringify(scope);
  const chip = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors duration-200",
      active ? "bg-brand-soft font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-medium tracking-tight">Notes</h1>
        <Button className="px-4" onClick={() => open("new")}>
          <Plus /> New note
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr] lg:grid-cols-[170px_280px_1fr]">
        {/* folders and tags */}
        <nav aria-label="Folders and tags" className={cn("space-y-3 md:col-span-2 lg:col-span-1", editorOpen && "hidden md:block")}>
          <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            <button type="button" className={chip(isScope({ kind: "all" }))} onClick={() => setScope({ kind: "all" })}>All notes</button>
            <button type="button" className={chip(isScope({ kind: "pinned" }))} onClick={() => setScope({ kind: "pinned" })}>
              <Pin className="size-3.5" /> Pinned
            </button>
            {folders?.map((f) => (
              <span key={f.id} className="group/f inline-flex shrink-0 items-center lg:flex">
                <button type="button" className={cn(chip(isScope({ kind: "folder", name: f.name })), "min-w-0 lg:flex-1")} onClick={() => setScope({ kind: "folder", name: f.name })}>
                  <Folder className="size-3.5 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{f.count}</span>
                </button>
                <span className="hidden items-center group-hover/f:flex">
                  <button type="button" aria-label={`Rename ${f.name}`} className="p-1 text-muted-foreground hover:text-foreground" onClick={() => renameFolder(f.id, f.name)}><Pencil className="size-3" /></button>
                  <button type="button" aria-label={`Delete ${f.name}`} className="p-1 text-muted-foreground hover:text-destructive" onClick={() => deleteFolder(f.id, f.name, f.count)}><Trash2 className="size-3" /></button>
                </span>
              </span>
            ))}
            <button type="button" className={chip(isScope({ kind: "none" }))} onClick={() => setScope({ kind: "none" })}>No folder</button>
            {newFolder === null ? (
              <button type="button" className={cn(chip(false), "text-muted-foreground")} onClick={() => setNewFolder("")}>
                <FolderPlus className="size-3.5" /> New folder
              </button>
            ) : (
              <Input
                autoFocus
                value={newFolder}
                placeholder="Folder name"
                aria-label="New folder name"
                className="h-8 w-36 lg:w-full"
                maxLength={60}
                onChange={(e) => setNewFolder(e.target.value)}
                onBlur={addFolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFolder();
                  if (e.key === "Escape") setNewFolder(null);
                }}
              />
            )}
          </div>
          {!!tags?.length && (
            <div className="hidden flex-wrap gap-1 lg:flex">
              {tags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => setScope(isScope({ kind: "tag", tag: t.tag }) ? { kind: "all" } : { kind: "tag", tag: t.tag })}
                  className={cn("rounded-full border px-2 py-0.5 text-xs transition-colors", isScope({ kind: "tag", tag: t.tag }) ? "border-brand bg-brand-soft" : "text-muted-foreground hover:bg-muted/60")}
                >
                  #{t.tag}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* list */}
        <div className={cn("space-y-3", editorOpen && "hidden md:block")}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {scope.kind === "tag" && (
            <button type="button" onClick={() => setScope({ kind: "all" })} className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand-soft px-2 py-0.5 text-xs">
              #{scope.tag} <X className="size-3" />
            </button>
          )}
          <div className="space-y-1">
            {loading && !notes && <div className="h-16 animate-pulse rounded-lg bg-muted" />}
            {notes?.length === 0 && (
              <div className="group/pupu flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
                <Pupu size={56} pose={debounced ? "search" : "sleepy"} className="mb-2" />
                <p>{debounced || scope.kind !== "all" ? "No notes match." : "No notes yet."}</p>
              </div>
            )}
            {notes?.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => open(n.id)}
                className={cn("block w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-200 hover:bg-muted/60", selectedId === n.id && "bg-muted")}
              >
                <span className="flex items-center gap-1.5">
                  {n.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relative(n.updated_at)}</span>
                </span>
                {n.content && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.content}</span>}
                {(n.folder || n.tags.length > 0) && (
                  <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                    {n.folder && <span className="inline-flex items-center gap-0.5"><Folder className="size-3" />{n.folder.name}</span>}
                    {n.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {editorOpen ? (
          <NoteEditor
            key={editorKey}
            note={selected}
            folderNames={folders?.map((f) => f.name) ?? []}
            onCreated={(id) => setSelectedId(id)}
            onClose={() => open(null)}
          />
        ) : (
          <Card className="group/pupu hidden items-center justify-center gap-3 py-20 text-center text-sm text-muted-foreground md:flex md:col-span-1">
            <Pupu pose="write" size={96} />
            <p>Pick a note on the left, or start a new one.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function NoteEditor({ note, folderNames, onCreated, onClose }: { note: Note | null; folderNames: string[]; onCreated: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(note));
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [state, setState] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [newFolderMode, setNewFolderMode] = useState(false);
  const noteId = useRef<string | null>(note?.id ?? null);
  const [savedId, setSavedId] = useState<string | null>(note?.id ?? null); // mirrors noteId.current for rendering
  const saved = useRef<Draft>(toDraft(note));
  const latest = useRef(draft);
  const busy = useRef(false);
  const again = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);

  const { data: detail, reload } = useData<NoteDetail | null>(() => (noteId.current ? api.note(noteId.current) : Promise.resolve(null)), [savedId]);

  // one save at a time; changes made while saving are picked up by another pass
  const save = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        const d = latest.current;
        if (JSON.stringify(d) === JSON.stringify(saved.current)) break;
        const title = d.title.trim() || d.content.trim().split("\n")[0].slice(0, 80);
        if (!noteId.current && !title) break; // nothing worth keeping yet
        if (!closed.current) setState("saving");
        try {
          const payload = { title: title || "Untitled", content: d.content, note_date: d.note_date || null, pinned: d.pinned, folder: d.folder || null, tags: normalizeTags(d.tags) };
          if (noteId.current) {
            await api.updateNote(noteId.current, payload);
          } else {
            const created = await api.createNote({ ...payload, note_date: payload.note_date ?? undefined });
            noteId.current = created.id;
            setSavedId(created.id);
            onCreated(created.id);
          }
          saved.current = d;
          if (!closed.current) setState(latest.current === d ? "saved" : "idle");
          notifyChanged();
        } catch (err) {
          if (!closed.current) setState("error");
          toast.error(err instanceof Error ? err.message : "Couldn't save the note");
          break;
        }
      } while (again.current || JSON.stringify(latest.current) !== JSON.stringify(saved.current));
    } finally {
      busy.current = false;
    }
  }, [onCreated]);

  // autosave a moment after the last change
  const change = useCallback(
    (patch: Partial<Draft>, immediate = false) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setDraft(next);
      setState("idle");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), immediate ? 0 : 900);
    },
    [save],
  );

  useEffect(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      void save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      closed.current = true;
      flush(); // leaving the note saves what is pending
    };
  }, [save]);

  async function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    if (timer.current) clearTimeout(timer.current);
    closed.current = true;
    try {
      if (noteId.current) await api.deleteNote(noteId.current);
      saved.current = latest.current; // nothing left to autosave
      onClose();
      toast.success("Note deleted");
      notifyChanged();
    } catch (err) {
      closed.current = false;
      toast.error(err instanceof Error ? err.message : "Couldn't delete the note");
    }
  }

  /** wrap the selection (or insert) in the textarea; keeps the caret sensible */
  function format(kind: "bold" | "italic" | "heading" | "list" | "task" | "link") {
    const ta = area.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    let out = value;
    let caret = e;
    const wrap = (mark: string, ph: string) => {
      const body = sel || ph;
      out = value.slice(0, s) + mark + body + mark + value.slice(e);
      caret = s + mark.length + body.length;
    };
    const linePrefix = (prefix: string) => {
      const start = value.lastIndexOf("\n", s - 1) + 1;
      out = value.slice(0, start) + prefix + value.slice(start);
      caret = e + prefix.length;
    };
    if (kind === "bold") wrap("**", "bold");
    if (kind === "italic") wrap("*", "italic");
    if (kind === "heading") linePrefix("## ");
    if (kind === "list") linePrefix("- ");
    if (kind === "task") linePrefix("- [ ] ");
    if (kind === "link") {
      const text = sel || "link text";
      out = `${value.slice(0, s)}[${text}](https://)${value.slice(e)}`;
      caret = s + text.length + 3 + "https://".length;
    }
    change({ content: out });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  }

  function addTag(raw: string) {
    const t = normalizeTag(raw);
    setTagInput("");
    if (!t || draft.tags.includes(t)) return;
    if (draft.tags.length >= 8) return toast.error("Up to 8 tags per note");
    change({ tags: [...draft.tags, t] }, true);
  }

  async function unlink(entity_type: "task" | "event" | "goal", entity_id: string) {
    if (!noteId.current) return;
    try {
      await api.unlinkNote(noteId.current, { entity_type, entity_id });
      await reload();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the link");
    }
  }

  const linked = new Set<string>([
    ...(detail?.links.tasks.map((t) => `task:${t.id}`) ?? []),
    ...(detail?.links.events.map((e) => `event:${e.id}`) ?? []),
    ...(detail?.links.goals.map((g) => `goal:${g.id}`) ?? []),
  ]);
  const hasLinks = !!detail && (detail.links.tasks.length || detail.links.events.length || detail.links.goals.length) > 0;
  const folderOptions = Array.from(new Set([...folderNames, ...(draft.folder ? [draft.folder] : [])]));

  const tool = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

  return (
    <Card className="motion-fade gap-3 px-4 py-4 md:col-span-1">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to notes" onClick={onClose}>
          <ArrowLeft />
        </Button>
        <Input type="date" className="h-8 w-auto" value={draft.note_date} onChange={(e) => change({ note_date: e.target.value }, true)} aria-label="Note date" />
        <span aria-live="polite" className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {state === "saving" && <><Loader2 className="size-3 animate-spin" /> Saving…</>}
          {state === "saved" && <><Check className="size-3" /> Saved</>}
          {state === "error" && <span className="text-destructive">Not saved</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={draft.pinned ? "Unpin note" : "Pin note"} title={draft.pinned ? "Unpin note" : "Pin note"} onClick={() => change({ pinned: !draft.pinned }, true)}>
            {draft.pinned ? <PinOff /> : <Pin />}
          </Button>
          <Button variant="ghost" size={confirmDelete ? "sm" : "icon-sm"} aria-label="Delete note" onClick={remove} className="text-destructive">
            <Trash2 />
            {confirmDelete && "Click again to delete"}
          </Button>
        </div>
      </div>

      <Input
        placeholder="Title"
        autoFocus={!note}
        className="h-auto border-0 px-0 text-[22px] font-medium tracking-tight shadow-none focus-visible:ring-0 md:text-[22px] dark:bg-transparent"
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
      />

      {/* folder and tags */}
      <div className="flex flex-wrap items-center gap-2">
        {newFolderMode ? (
          <Input
            autoFocus
            placeholder="Folder name"
            aria-label="New folder name"
            className="h-8 w-40"
            maxLength={60}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) change({ folder: v }, true);
              setNewFolderMode(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setNewFolderMode(false);
            }}
          />
        ) : (
          <SelectField
            className="w-40"
            aria-label="Folder"
            value={draft.folder}
            onChange={(e) => (e.target.value === "__new" ? setNewFolderMode(true) : change({ folder: e.target.value }, true))}
          >
            <option value="">No folder</option>
            {folderOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="__new">+ New folder…</option>
          </SelectField>
        )}
        {draft.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
            #{t}
            <button type="button" aria-label={`Remove tag ${t}`} className="text-muted-foreground hover:text-foreground" onClick={() => change({ tags: draft.tags.filter((x) => x !== t) }, true)}><X className="size-3" /></button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Tag className="size-3" />
          <input
            value={tagInput}
            onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
              if (e.key === "Backspace" && !tagInput && draft.tags.length) change({ tags: draft.tags.slice(0, -1) }, true);
            }}
            onBlur={() => tagInput && addTag(tagInput)}
            placeholder="Add tag"
            aria-label="Add tag"
            className="w-20 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-y py-1">
        <button type="button" className={tool} aria-label="Bold" title="Bold" disabled={mode === "preview"} onClick={() => format("bold")}><Bold className="size-4" /></button>
        <button type="button" className={tool} aria-label="Italic" title="Italic" disabled={mode === "preview"} onClick={() => format("italic")}><Italic className="size-4" /></button>
        <button type="button" className={tool} aria-label="Heading" title="Heading" disabled={mode === "preview"} onClick={() => format("heading")}><Heading2 className="size-4" /></button>
        <button type="button" className={tool} aria-label="Bullet list" title="Bullet list" disabled={mode === "preview"} onClick={() => format("list")}><List className="size-4" /></button>
        <button type="button" className={tool} aria-label="Checklist" title="Checklist" disabled={mode === "preview"} onClick={() => format("task")}><ListChecks className="size-4" /></button>
        <button type="button" className={tool} aria-label="Link" title="Link" disabled={mode === "preview"} onClick={() => format("link")}><Link2 className="size-4" /></button>
        <div role="tablist" aria-label="Editor mode" className="ml-auto inline-flex rounded-lg bg-muted p-0.5 text-[13px]">
          {(["write", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-md px-2.5 py-1 capitalize transition-colors", mode === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "write" ? (
        <textarea
          ref={area}
          placeholder="Start writing… Markdown works."
          aria-label="Note content"
          className="min-h-[44dvh] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          value={draft.content}
          onChange={(e) => change({ content: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (timer.current) clearTimeout(timer.current);
              void save();
            }
          }}
        />
      ) : (
        <div className="min-h-[44dvh]">
          <MarkdownView source={draft.content} onToggleTask={(line) => change({ content: toggleTaskLine(latest.current.content, line) }, true)} />
        </div>
      )}

      {/* links */}
      <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
        <span className="text-muted-foreground">Linked to</span>
        {detail?.links.goals.map((g) => (
          <LinkChip key={g.id} href={`/app/goals/${g.id}`} icon={<Target className="size-3" />} label={g.title} onRemove={() => unlink("goal", g.id)} />
        ))}
        {detail?.links.tasks.map((t) => (
          <LinkChip key={t.id} href="/app/todos" icon={<ListChecks className="size-3" />} label={t.title} done={t.done} onRemove={() => unlink("task", t.id)} />
        ))}
        {detail?.links.events.map((ev) => (
          <LinkChip key={ev.id} href="/app/calendar" icon={<CalendarDays className="size-3" />} label={ev.title} onRemove={() => unlink("event", ev.id)} />
        ))}
        {!hasLinks && <span className="text-muted-foreground">nothing yet</span>}
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          disabled={!savedId}
          title={savedId ? "Link a goal, task or event" : "Write something first, then link"}
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="size-3" /> Link
        </Button>
      </div>
      {savedId && (
        <NoteLinkPicker open={pickerOpen} onOpenChange={setPickerOpen} noteId={savedId} linked={linked} onLinked={() => void reload()} />
      )}
    </Card>
  );
}

function LinkChip({ href, icon, label, done, onRemove }: { href: string; icon: React.ReactNode; label: string; done?: boolean; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2">
      {icon}
      <Link href={href} className={cn("truncate hover:underline", done && "line-through opacity-70")}>{label}</Link>
      <button type="button" aria-label={`Remove link to ${label}`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" onClick={onRemove}>
        <X className="size-3" />
      </button>
    </span>
  );
}
