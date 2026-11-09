export const EVENT_COLORS = ["blue", "green", "red", "orange", "purple", "pink", "gray"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string; // ISO UTC
  end_at: string | null; // ISO UTC
  all_day: boolean;
  color: EventColor;
  done: boolean;
  repeat_days: number[] | null; // weekdays, 0 = Sunday; null = doesn't repeat
  repeat_until: string | null; // YYYY-MM-DD
  /** set on generated occurrences: when the series' first occurrence starts */
  series_start_at?: string;
  created_at: string;
  updated_at: string;
};

export type Todo = {
  id: string;
  title: string;
  note: string | null;
  due_date: string | null; // YYYY-MM-DD
  important: boolean;
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  note_date: string | null; // YYYY-MM-DD
  event_id: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type Summary = {
  today: string;
  todayEvents: CalendarEvent[];
  upcoming: CalendarEvent[];
  overdue: CalendarEvent[];
  todos: Todo[];
  recentNotes: Note[];
  counts: { thisWeek: number; thisMonth: number; doneThisWeek: number; notes: number; todosOpen: number };
};
