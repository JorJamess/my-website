import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getHabitsOverview, listGoals, listNotes, listTodos, searchEvents } from "@/lib/server/repo";

export const GET = api(async (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ events: [], notes: [], todos: [], habits: [], goals: [] });
  const needle = q.toLowerCase();
  const [events, notes, todos, habits, goals] = await Promise.all([
    searchEvents(q, 8),
    listNotes({ q, limit: 8 }),
    listTodos({ q, includeDone: true, limit: 8 }),
    getHabitsOverview({ includeArchived: true }),
    listGoals({ includeInactive: true }),
  ]);
  return NextResponse.json({
    events,
    notes,
    todos,
    habits: habits.filter((h) => h.title.toLowerCase().includes(needle)).slice(0, 8).map((h) => ({ id: h.id, title: h.title, archived: !!h.archived_at })),
    goals: goals.filter((g) => g.title.toLowerCase().includes(needle)).slice(0, 8).map((g) => ({ id: g.id, title: g.title, status: g.status })),
  });
});
