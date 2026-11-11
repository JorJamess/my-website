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

export type TodoStatus = "todo" | "doing" | "done";
export const TODO_PRIORITIES = ["none", "low", "medium", "high"] as const;
export type TodoPriorityName = (typeof TODO_PRIORITIES)[number];

export type Category = { id: string; name: string; color: EventColor; kind: string };

export type Todo = {
  id: string;
  title: string;
  note: string | null;
  due_date: string | null; // YYYY-MM-DD
  /** 0 none, 1 low, 2 medium, 3 high */
  priority: number;
  status: TodoStatus;
  category: { id: string; name: string; color: EventColor } | null;
  /** set on subtasks: the id of the parent task (one level only) */
  parent_id: string | null;
  /** true when priority is high (kept for older callers) */
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
  event_id: string | null; // the first linked event, kept for older callers
  folder: { id: string; name: string } | null;
  tags: string[];
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
  /** open top-level tasks whose due date has passed */
  overdueTodos: Todo[];
  /** tasks due today (done or not) plus open high-priority tasks that aren't overdue */
  todosFocus: Todo[];
  habitsToday: HabitToday[];
  goalsActive: GoalBrief[];
  recentNotes: Note[];
  counts: { thisWeek: number; thisMonth: number; doneThisWeek: number; notes: number; todosOpen: number };
};

export type HabitScheduleType = "daily" | "weekdays" | "interval";

export type Habit = {
  id: string;
  title: string;
  description: string | null;
  color: EventColor;
  schedule_type: HabitScheduleType;
  weekdays: number[] | null; // 0 = Sunday
  interval_days: number | null;
  start_date: string; // YYYY-MM-DD
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** done = checked in; missed = scheduled, past, not done; due = scheduled today, not done yet;
 *  upcoming = scheduled in the future; off = not scheduled */
export type HabitDayState = "done" | "missed" | "due" | "upcoming" | "off";

export type HabitStats = {
  current_streak: number; // consecutive scheduled days done, ending at the latest closed scheduled day
  longest_streak: number;
  last30: { done: number; scheduled: number; rate: number | null };
  done_today: boolean;
  scheduled_today: boolean;
  total_checkins: number;
};

export type HabitOverview = Habit & {
  stats: HabitStats;
  /** the last 12 weeks, Monday of the first week up to Sunday of this week */
  history: { day: string; state: HabitDayState }[];
};

export type HabitToday = { id: string; title: string; color: EventColor; done: boolean; current_streak: number };

export const GOAL_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalHorizon = "short" | "long";
export const GOAL_LINK_TYPES = ["task", "habit", "event", "note"] as const;
export type GoalLinkType = (typeof GOAL_LINK_TYPES)[number];

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  horizon: GoalHorizon;
  category: { id: string; name: string; color: EventColor } | null;
  priority: number; // 0 none, 1 low, 2 medium, 3 high
  status: GoalStatus;
  color: EventColor;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Milestone = { id: string; goal_id: string; title: string; due_date: string | null; done_at: string | null; sort_order: number };

export type GoalProgress = {
  milestones: { done: number; total: number };
  tasks: { done: number; total: number };
  /** (milestones done + tasks done) / (milestones + tasks); null when there is nothing to measure yet */
  percent: number | null;
};

export type GoalOverview = Goal & {
  progress: GoalProgress;
  /** whole days until the target date (negative = past); null without a target date */
  days_left: number | null;
  /** active, has a target date and it has passed */
  overdue: boolean;
  link_counts: { task: number; habit: number; event: number; note: number };
};

export type GoalDetail = GoalOverview & {
  milestones: Milestone[];
  links: {
    tasks: Todo[];
    habits: { id: string; title: string; color: EventColor; current_streak: number; rate_30d: number | null; archived: boolean }[];
    events: { id: string; title: string; start_at: string; all_day: boolean; color: EventColor }[];
    notes: { id: string; title: string }[];
  };
};

export type GoalBrief = { id: string; title: string; color: EventColor; percent: number | null; days_left: number | null; target_date: string | null; overdue: boolean };

export type NoteDetail = Note & {
  links: {
    tasks: { id: string; title: string; done: boolean }[];
    events: { id: string; title: string; start_at: string; all_day: boolean; color: EventColor }[];
    goals: { id: string; title: string; color: EventColor }[];
  };
};

export type NoteFolder = { id: string; name: string; count: number };
export const NOTE_LINK_TYPES = ["task", "event", "goal"] as const;
export type NoteLinkType = (typeof NOTE_LINK_TYPES)[number];

export const SEARCH_TYPES = ["notes", "tasks", "events", "goals", "habits"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchAllResult = {
  q: string;
  counts: Record<SearchType, number>;
  notes: Note[];
  tasks: Todo[];
  events: CalendarEvent[];
  goals: { id: string; title: string; description: string | null; status: string; target_date: string | null }[];
  habits: { id: string; title: string; archived: boolean }[];
};

export type ActionRisk = "delete" | "edit" | "link" | "vault";
export type PendingStatus = "pending" | "approved" | "rejected" | "failed" | "expired";
export type PendingAction = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  risk: ActionRisk;
  status: PendingStatus;
  note: string | null;
  created_at: string;
  decided_at: string | null;
};
export type AuditEntry = { id: string; at: string; actor: "claude" | "you"; action: string; summary: string; ok: boolean; pending_id: string | null };
