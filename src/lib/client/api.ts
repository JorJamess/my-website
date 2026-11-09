"use client";

import type { CalendarEvent, Note, Summary, Todo } from "@/lib/types";
import type { MoneyCalendar, MoneySummary, MoneyTransaction } from "@/lib/money-types";
import type { EventCreateInput, EventUpdateInput, NoteCreateInput, NoteUpdateInput, TodoCreateInput, TodoUpdateInput } from "@/lib/schemas";

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

  summary: () => request<Summary>("/api/summary"),

  events: (from: string, to: string) =>
    request<{ events: CalendarEvent[] }>(`/api/events?from=${from}&to=${to}`).then((r) => r.events),
  createEvent: (input: EventCreateInput) =>
    request<{ event: CalendarEvent }>("/api/events", json("POST", input)).then((r) => r.event),
  updateEvent: (id: string, input: EventUpdateInput) =>
    request<{ event: CalendarEvent }>(`/api/events/${id}`, json("PATCH", input)).then((r) => r.event),
  deleteEvent: (id: string) => request<{ ok: true }>(`/api/events/${id}`, json("DELETE")),

  todos: (includeDone = false) =>
    request<{ todos: Todo[] }>(`/api/todos${includeDone ? "?done=1" : ""}`).then((r) => r.todos),
  createTodo: (input: TodoCreateInput) =>
    request<{ todo: Todo }>("/api/todos", json("POST", input)).then((r) => r.todo),
  updateTodo: (id: string, input: TodoUpdateInput) =>
    request<{ todo: Todo }>(`/api/todos/${id}`, json("PATCH", input)).then((r) => r.todo),
  deleteTodo: (id: string) => request<{ ok: true }>(`/api/todos/${id}`, json("DELETE")),

  notes: (q?: string) =>
    request<{ notes: Note[] }>(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.notes),
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
    request<{ backups: { key: string; created_at: string; reason: string; events: number; notes: number; bytes: number }[] }>(
      "/api/backups",
    ).then((r) => r.backups),
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
