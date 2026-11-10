import "server-only";
import { SEARCH_TYPES, type CalendarEvent, type Note, type SearchAllResult, type SearchType, type Todo } from "@/lib/types";
export { SEARCH_TYPES, type SearchAllResult, type SearchType };
import { localDateKey } from "@/lib/time";
import { searchEvents } from "../events/repo";
import { listNotes } from "../notes/repo";
import { listTodos } from "../tasks/repo";
import { getHabitsOverview } from "../habits/repo";
import { listGoals } from "../goals/repo";

export type SearchAllFilters = {
  q: string;
  types?: SearchType[];
  /** YYYY-MM-DD, inclusive. Applies to events (start day), tasks (due date), notes (note date, else last edit) and goals (target date). */
  from?: string;
  to?: string;
  /** open = not finished, done = finished. Applies to tasks, events, goals and habits; notes have no status. */
  status?: "open" | "done";
  /** note folder name or "none"; narrows to notes */
  folder?: string;
  /** note tag; narrows to notes */
  tag?: string;
  limit?: number;
};

const inRange = (day: string | null | undefined, from?: string, to?: string) => {
  if (!from && !to) return true;
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
};

/** One search across notes, tasks, events, goals and habits, with the filters the search page offers. */
export async function searchAll(f: SearchAllFilters): Promise<SearchAllResult> {
  const q = f.q.trim().slice(0, 100);
  const needle = q.toLowerCase();
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const noteOnly = !!(f.folder || f.tag);
  const wanted = (t: SearchType) => (!f.types?.length || f.types.includes(t)) && (!noteOnly || t === "notes");
  const dated = !!(f.from || f.to);

  const [notes, tasks, events, goals, habits] = await Promise.all([
    wanted("notes") && !f.status && (q || noteOnly)
      ? listNotes({ q: q || undefined, folder: f.folder, tag: f.tag, limit: 200 })
      : Promise.resolve([] as Note[]),
    wanted("tasks") && q ? listTodos({ q, includeDone: true, limit: 200 }) : Promise.resolve([] as Todo[]),
    wanted("events") && q ? searchEvents(q, 200) : Promise.resolve([] as CalendarEvent[]),
    wanted("goals") && q ? listGoals({ includeInactive: true }) : Promise.resolve([]),
    wanted("habits") && q && !dated ? getHabitsOverview({ includeArchived: true }) : Promise.resolve([]),
  ]);

  const noteHits = notes.filter((n) => inRange(n.note_date ?? localDateKey(new Date(n.updated_at)), f.from, f.to)).slice(0, limit);
  const taskHits = tasks
    .filter((t) => (f.status === "open" ? !t.done : f.status === "done" ? t.done : true) && inRange(t.due_date, f.from, f.to))
    .slice(0, limit);
  const eventHits = events
    .filter((e) => (f.status === "open" ? !e.done : f.status === "done" ? e.done : true) && inRange(localDateKey(new Date(e.start_at)), f.from, f.to))
    .slice(0, limit);
  const goalHits = goals
    .filter((g) => g.title.toLowerCase().includes(needle) || (g.description ?? "").toLowerCase().includes(needle))
    .filter((g) => (f.status === "open" ? g.status === "active" || g.status === "paused" : f.status === "done" ? g.status === "done" : true) && inRange(g.target_date, f.from, f.to))
    .slice(0, limit)
    .map((g) => ({ id: g.id, title: g.title, description: g.description, status: g.status, target_date: g.target_date }));
  const habitHits = habits
    .filter((h) => h.title.toLowerCase().includes(needle))
    .filter((h) => (f.status === "open" ? !h.archived_at : f.status === "done" ? !!h.archived_at : true))
    .slice(0, limit)
    .map((h) => ({ id: h.id, title: h.title, archived: !!h.archived_at }));

  return {
    q,
    counts: { notes: noteHits.length, tasks: taskHits.length, events: eventHits.length, goals: goalHits.length, habits: habitHits.length },
    notes: noteHits,
    tasks: taskHits,
    events: eventHits,
    goals: goalHits,
    habits: habitHits,
  };
}
