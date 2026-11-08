"use client";

import type { CalendarEvent, Note, Summary } from "@/lib/types";
import type { MoneyCalendar, MoneySummary, MoneyTransaction } from "@/lib/money-types";
import type { EventCreateInput, EventUpdateInput, NoteCreateInput, NoteUpdateInput } from "@/lib/schemas";

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
        ? "ข้อมูลไม่ถูกต้อง: " + (data.issues ?? []).map((i) => `${i.path.join(".")} ${i.message}`).join(", ")
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

  connect: () =>
    request<{ configured: boolean; origin: string; urlWithKey: string | null; urlBearer: string; token: string | null }>(
      "/api/connect",
    ),
};
