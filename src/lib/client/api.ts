"use client";

import type { Analytics } from "@/modules/analytics/repo";
import type { CalendarItems } from "@/modules/calendar/repo";
import type { CalendarEvent, Category, EventColor, GoalDetail, GoalOverview, HabitOverview, Note, NoteDetail, NoteFolder, Summary, Todo } from "@/lib/types";
import type { MoneyCalendar, MoneySummary, MoneyTransaction } from "@/lib/money-types";
import type { EventCreateInput, EventUpdateInput, NoteCreateInput, NoteUpdateInput, NoteLinkInput, TodoCreateInput, TodoUpdateInput, HabitCreateInput, HabitUpdateInput, CheckinInput, GoalCreateInput, GoalUpdateInput, MilestoneCreateInput, MilestoneUpdateInput, GoalLinkInput } from "@/lib/schemas";

export const UNAUTHORIZED_EVENT = "mw:unauthorized";
export const DATA_CHANGED_EVENT = "mw:data-changed";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    issues?: { path: string[]; message: string }[];
  };
  if (!res.ok) {
    const msg =
      data?.error === "invalid_input"
        ? "Check these fields: " + (data.issues ?? []).map((i) => `${i.path.join(".")} ${i.message}`).join(", ")
        : data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** แจ้งทุกหน้าว่าข้อมูลเปลี่ยน ให้โหลดใหม่ */
export const notifyChanged = () => window.dispatchEvent(new Event(DATA_CHANGED_EVENT));

export const api = {
  me: () => request<{ authed: boolean }>("/api/auth/me"),
  login: (password: string) => request<{ ok: true }>("/api/auth/login", json("POST", { password })),
  logout: () => request<{ ok: true }>("/api/auth/logout", json("POST")),
  logoutEverywhere: () => request<{ ok: true }>("/api/auth/logout-all", json("POST")),

  summary: () => request<Summary>("/api/summary"),

  events: (from: string, to: string) =>
    request<{ events: CalendarEvent[] }>(`/api/events?from=${from}&to=${to}`).then((r) => r.events),
  createEvent: (input: EventCreateInput) =>
    request<{ event: CalendarEvent }>("/api/events", json("POST", input)).then((r) => r.event),
  updateEvent: (id: string, input: EventUpdateInput) =>
    request<{ event: CalendarEvent }>(`/api/events/${id}`, json("PATCH", input)).then((r) => r.event),
  deleteEvent: (id: string) => request<{ ok: true }>(`/api/events/${id}`, json("DELETE")),
  /** take one occurrence of a repeating event out of the series */
  skipOccurrence: (id: string, day: string) => request<{ ok: true }>(`/api/events/${id}/occurrences`, json("POST", { action: "skip", day })),
  /** edit just one occurrence: it leaves the series and becomes its own event */
  editOccurrence: (id: string, day: string, event: EventCreateInput) =>
    request<{ event: CalendarEvent }>(`/api/events/${id}/occurrences`, json("POST", { action: "edit", day, event })).then((r) => r.event),

  todos: (includeDone = false) =>
    request<{ todos: Todo[] }>(`/api/todos${includeDone ? "?done=1" : ""}`).then((r) => r.todos),
  todosWithCategories: (includeDone = true) =>
    request<{ todos: Todo[]; categories: Category[] }>(`/api/todos${includeDone ? "?done=1" : ""}`),
  deleteCategory: (id: string) => request<{ ok: true }>(`/api/categories/${id}`, json("DELETE")),
  createTodo: (input: TodoCreateInput) =>
    request<{ todo: Todo }>("/api/todos", json("POST", input)).then((r) => r.todo),
  updateTodo: (id: string, input: TodoUpdateInput) =>
    request<{ todo: Todo }>(`/api/todos/${id}`, json("PATCH", input)).then((r) => r.todo),
  deleteTodo: (id: string) => request<{ ok: true }>(`/api/todos/${id}`, json("DELETE")),

  search: (q: string) =>
    request<{
      events: CalendarEvent[];
      notes: Note[];
      todos: Todo[];
      habits: { id: string; title: string; archived: boolean }[];
      goals: { id: string; title: string; status: string }[];
    }>(`/api/search?q=${encodeURIComponent(q)}`),

  habits: (includeArchived = false) =>
    request<{ habits: HabitOverview[] }>(`/api/habits${includeArchived ? "?archived=1" : ""}`).then((r) => r.habits),
  createHabit: (input: HabitCreateInput) => request<{ habit: unknown }>("/api/habits", json("POST", input)),
  updateHabit: (id: string, input: HabitUpdateInput) => request<{ habit: unknown }>(`/api/habits/${id}`, json("PATCH", input)),
  deleteHabit: (id: string) => request<{ ok: true }>(`/api/habits/${id}`, json("DELETE")),
  checkin: (id: string, input: CheckinInput) => request<{ ok: true }>(`/api/habits/${id}/checkins`, json("PUT", input)),

  calendarItems: (from: string, to: string) => request<CalendarItems>(`/api/calendar/items?from=${from}&to=${to}`),
  colorNames: () => request<{ names: Record<EventColor, string> }>("/api/settings/colors").then((r) => r.names),
  setColorNames: (names: Partial<Record<EventColor, string>>) =>
    request<{ names: Record<EventColor, string> }>("/api/settings/colors", json("PUT", names)).then((r) => r.names),
  analytics: (range: "week" | "month", offset = 0) => request<Analytics>(`/api/analytics?range=${range}&offset=${offset}`),
  goals: (all = false) =>
    request<{ goals: GoalOverview[]; categories: Category[] }>(`/api/goals${all ? "?all=1" : ""}`),
  goal: (id: string) => request<{ goal: GoalDetail; categories: Category[] }>(`/api/goals/${id}`),
  createGoal: (input: GoalCreateInput) => request<{ goal: GoalOverview }>("/api/goals", json("POST", input)).then((r) => r.goal),
  updateGoal: (id: string, input: GoalUpdateInput) => request<{ goal: GoalOverview }>(`/api/goals/${id}`, json("PATCH", input)).then((r) => r.goal),
  deleteGoal: (id: string) => request<{ ok: true }>(`/api/goals/${id}`, json("DELETE")),
  addMilestone: (goalId: string, input: MilestoneCreateInput) => request<{ milestone: unknown }>(`/api/goals/${goalId}/milestones`, json("POST", input)),
  updateMilestone: (goalId: string, id: string, input: MilestoneUpdateInput) =>
    request<{ milestone: unknown }>(`/api/goals/${goalId}/milestones/${id}`, json("PATCH", input)),
  deleteMilestone: (goalId: string, id: string) => request<{ ok: true }>(`/api/goals/${goalId}/milestones/${id}`, json("DELETE")),
  linkGoal: (goalId: string, input: GoalLinkInput) => request<{ ok: true }>(`/api/goals/${goalId}/links`, json("POST", input)),
  unlinkGoal: (goalId: string, input: GoalLinkInput) => request<{ ok: true }>(`/api/goals/${goalId}/links`, json("DELETE", input)),

  notes: (f: { q?: string; folder?: string; tag?: string; pinned?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.folder) p.set("folder", f.folder);
    if (f.tag) p.set("tag", f.tag);
    if (f.pinned) p.set("pinned", "1");
    const qs = p.toString();
    return request<{ notes: Note[] }>(`/api/notes${qs ? `?${qs}` : ""}`).then((r) => r.notes);
  },
  note: (id: string) => request<{ note: NoteDetail }>(`/api/notes/${id}`).then((r) => r.note),
  noteFolders: () => request<{ folders: NoteFolder[] }>("/api/notes/folders").then((r) => r.folders),
  createNoteFolder: (name: string) => request<{ folder: NoteFolder }>("/api/notes/folders", json("POST", { name })).then((r) => r.folder),
  renameNoteFolder: (id: string, name: string) => request<{ folder: NoteFolder }>(`/api/notes/folders/${id}`, json("PATCH", { name })).then((r) => r.folder),
  deleteNoteFolder: (id: string) => request<{ ok: true }>(`/api/notes/folders/${id}`, json("DELETE")),
  noteTags: () => request<{ tags: { tag: string; count: number }[] }>("/api/notes/tags").then((r) => r.tags),
  linkNote: (id: string, input: NoteLinkInput) => request<{ note: NoteDetail }>(`/api/notes/${id}/links`, json("POST", input)).then((r) => r.note),
  unlinkNote: (id: string, input: NoteLinkInput) => request<{ note: NoteDetail }>(`/api/notes/${id}/links`, json("DELETE", input)).then((r) => r.note),
  createNote: (input: NoteCreateInput) =>
    request<{ note: Note }>("/api/notes", json("POST", input)).then((r) => r.note),
  updateNote: (id: string, input: NoteUpdateInput) =>
    request<{ note: Note }>(`/api/notes/${id}`, json("PATCH", input)).then((r) => r.note),
  deleteNote: (id: string) => request<{ ok: true }>(`/api/notes/${id}`, json("DELETE")),

  moneySummary: (month?: string) => request<MoneySummary>(`/api/money/summary${month ? `?month=${month}` : ""}`),
  /** from/to แบบ inclusive */
  moneyCalendar: (from: string, to: string) => request<MoneyCalendar>(`/api/money/calendar?from=${from}&to=${to}`),
  moneyTransactions: (from: string, to: string) =>
    request<{ transactions: MoneyTransaction[] }>(`/api/money/transactions?from=${from}&to=${to}`).then((r) => r.transactions),

  backups: () =>
    request<{
      backups: { key: string; created_at: string; reason: string; counts?: Record<string, number>; events?: number; notes?: number; bytes: number }[];
    }>("/api/backups").then((r) => r.backups),
  restorePreview: (key: string) =>
    request<{ preview: { table: string; current: number; incoming: number }[] }>(
      "/api/backups/restore",
      json("POST", { key }),
    ).then((r) => r.preview),
  restore: (key: string) =>
    request<{ ok: true; restored: Record<string, number> }>("/api/backups/restore", json("POST", { key, confirm: true })),
  backupNow: () => request<{ backup: { key: string } }>("/api/backups", json("POST")),

  messages: () =>
    request<{
      unread: number;
      messages: { id: string; name: string; email: string; topic: string; body: string; lang: string; read: boolean; created_at: string }[];
    }>("/api/messages"),
  markMessage: (id: string, read: boolean) => request<{ ok: true }>(`/api/messages/${id}`, json("PATCH", { read })),
  deleteMessage: (id: string) => request<{ ok: true }>(`/api/messages/${id}`, json("DELETE")),

  stats: (days = 14) =>
    request<{
      days: number;
      total: number;
      byDay: { day: string; views: number }[];
      byLang: { en: number; th: number };
      topRefs: { ref: string; views: number }[];
      topCountries: { country: string; views: number }[];
    }>(`/api/stats?days=${days}`),

  connect: () =>
    request<{ configured: boolean; origin: string; urlWithKey: string | null; urlBearer: string; token: string | null }>(
      "/api/connect",
    ),
};
