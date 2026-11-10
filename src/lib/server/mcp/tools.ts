import "server-only";
import { z } from "zod";
import {
  eventCreateSchema,
  eventUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  todoCreateSchema,
  todoUpdateSchema,
  habitCreateSchema,
  habitUpdateSchema,
  checkinSchema,
  goalCreateSchema,
  goalUpdateSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  goalLinkSchema,
} from "@/lib/schemas";
import * as repo from "@/lib/server/repo";
import { listMessages, setMessageRead } from "@/lib/server/messages";
import { getVisitStats } from "@/lib/analytics-core";
import { getEnv } from "@/lib/server/env";
import { addDaysKey, formatLocal, localDateKey } from "@/lib/time";
import { repeatLabel } from "@/lib/recurrence";
import { scheduleLabel } from "@/lib/habits";
import { GOAL_STATUSES, TODO_PRIORITIES, type CalendarEvent, type GoalDetail, type GoalOverview, type HabitOverview, type HabitToday, type Note, type Todo } from "@/lib/types";

type ToolDef = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run: (args: never, tz: string) => Promise<unknown>;
};

const id = z.string().min(1).describe("id ของรายการ");

function fmtEvent(e: CalendarEvent, tz: string) {
  const base = {
    id: e.id,
    title: e.title,
    all_day: e.all_day,
    start: e.all_day ? localDateKey(new Date(e.start_at), tz) : formatLocal(e.start_at, tz),
    end: e.end_at
      ? e.all_day
        ? localDateKey(new Date(new Date(e.end_at).getTime() - 1), tz) // วันสุดท้าย (inclusive)
        : formatLocal(e.end_at, tz)
      : null,
    done: e.done,
    color: e.color,
    ...(e.repeat_days ? { repeats: repeatLabel(e.repeat_days, e.repeat_until), repeat_days: e.repeat_days, repeat_until: e.repeat_until } : {}),
  };
  return {
    ...base,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
  };
}

function fmtTodo(t: Todo) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    done: t.done,
    priority: TODO_PRIORITIES[t.priority] ?? "none",
    due_date: t.due_date,
    ...(t.category ? { category: t.category.name } : {}),
    ...(t.parent_id ? { parent_id: t.parent_id } : {}),
    ...(t.note ? { note: t.note } : {}),
  };
}

function fmtHabit(h: HabitOverview) {
  const s = h.stats;
  return {
    id: h.id,
    title: h.title,
    schedule: scheduleLabel(h),
    start_date: h.start_date,
    scheduled_today: s.scheduled_today,
    done_today: s.done_today,
    current_streak: s.current_streak,
    longest_streak: s.longest_streak,
    last_30_days: { done: s.last30.done, scheduled: s.last30.scheduled, rate: s.last30.rate === null ? null : Math.round(s.last30.rate * 100) / 100 },
    total_checkins: s.total_checkins,
    // oldest to newest, this week's Monday..Sunday: done | missed | due | upcoming | off
    this_week: h.history.slice(-7).map((d) => ({ day: d.day, state: d.state })),
    ...(h.archived_at ? { archived: true } : {}),
    ...(h.description ? { description: h.description } : {}),
  };
}
const fmtHabitToday = (h: HabitToday) => ({ id: h.id, title: h.title, done: h.done, current_streak: h.current_streak });

function fmtGoal(g: GoalOverview) {
  const p = g.progress;
  return {
    id: g.id,
    title: g.title,
    status: g.status,
    horizon: g.horizon,
    priority: TODO_PRIORITIES[g.priority] ?? "none",
    ...(g.category ? { category: g.category.name } : {}),
    start_date: g.start_date,
    target_date: g.target_date,
    days_left: g.days_left,
    overdue: g.overdue,
    // raw counts first; percent is just done/total across milestones and linked tasks (null = nothing to measure yet)
    progress: {
      milestones: `${p.milestones.done}/${p.milestones.total}`,
      linked_tasks: `${p.tasks.done}/${p.tasks.total}`,
      percent: p.percent === null ? null : Math.round(p.percent * 100),
    },
    linked: g.link_counts,
    ...(g.description ? { description: g.description } : {}),
  };
}

function fmtGoalDetail(g: GoalDetail) {
  return {
    ...fmtGoal(g),
    milestones: g.milestones.map((m) => ({ id: m.id, title: m.title, done: !!m.done_at, due_date: m.due_date })),
    tasks: g.links.tasks.map(fmtTodo),
    habits: g.links.habits.map((h) => ({ id: h.id, title: h.title, current_streak: h.current_streak, rate_30d: h.rate_30d === null ? null : Math.round(h.rate_30d * 100) / 100 })),
    events: g.links.events.map((e) => ({ id: e.id, title: e.title, start: e.all_day ? e.start_at.slice(0, 10) : e.start_at })),
    notes: g.links.notes,
  };
}

function fmtNote(n: Note, full = true) {
  return {
    id: n.id,
    title: n.title,
    ...(full ? { content: n.content } : { preview: n.content.slice(0, 200) }),
    note_date: n.note_date,
    event_id: n.event_id,
    pinned: n.pinned,
    updated_at: n.updated_at,
  };
}

function define<S extends z.ZodObject>(def: {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations?: ToolDef["annotations"];
  run: (args: z.infer<S>, tz: string) => Promise<unknown>;
}): ToolDef {
  return def as unknown as ToolDef;
}

export const tools: ToolDef[] = [
  define({
    name: "get_summary",
    title: "สรุปกำหนดการ",
    description:
      "สรุปภาพรวม: งานวันนี้ (รวมงานที่ทำซ้ำ), งานที่กำลังจะมาถึงใน N วัน, งานที่เลยกำหนดแต่ยังไม่เสร็จ, To-do ที่ยังไม่เสร็จ, นิสัย (habits) ที่ต้องทำวันนี้, เป้าหมาย (goals) ที่กำลังทำ, บันทึกล่าสุด และสถิติสัปดาห์/เดือน",
    schema: z.object({
      days: z.number().int().min(1).max(60).optional().describe("จำนวนวันข้างหน้าที่จะดู (ค่าเริ่มต้น 7)"),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ days }, tz) => {
      const s = await repo.getSummary(days ?? 7);
      return {
        today: s.today,
        timezone: tz,
        today_events: s.todayEvents.map((e) => fmtEvent(e, tz)),
        upcoming: s.upcoming.map((e) => fmtEvent(e, tz)),
        overdue_not_done: s.overdue.map((e) => fmtEvent(e, tz)),
        open_todos: s.todos.map(fmtTodo),
        overdue_todos: s.overdueTodos.map(fmtTodo),
        todos_due_today_or_high_priority: s.todosFocus.map(fmtTodo),
        habits_today: s.habitsToday.map(fmtHabitToday),
        active_goals: s.goalsActive.map((g) => ({ id: g.id, title: g.title, percent: g.percent === null ? null : Math.round(g.percent * 100), days_left: g.days_left, overdue: g.overdue })),
        recent_notes: s.recentNotes.map((n) => fmtNote(n, false)),
        counts: s.counts,
      };
    },
  }),
  define({
    name: "list_events",
    title: "ดูงานในช่วงวันที่",
    description:
      "ดึงรายการงานที่ทับช่วงเวลา from–to (to แบบ exclusive). ถ้าไม่ระบุ จะใช้วันนี้ถึงอีก 7 วัน",
    schema: z.object({
      from: z.string().optional().describe("เริ่ม เช่น 2026-11-01"),
      to: z.string().optional().describe("สิ้นสุด (ไม่รวม) เช่น 2026-12-01"),
      query: z.string().optional().describe("คำค้นในชื่อ/รายละเอียด/สถานที่"),
      include_done: z.boolean().optional().describe("รวมงานที่เสร็จแล้ว (ค่าเริ่มต้น true)"),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ from, to, query, include_done }, tz) => {
      const today = localDateKey(new Date(), tz);
      const f = from ?? today;
      const t = to ?? addDaysKey(today, 8);
      const events = await repo.listEvents({ from: f, to: t, q: query, includeDone: include_done ?? true });
      return { from: f, to: t, count: events.length, events: events.map((e) => fmtEvent(e, tz)) };
    },
  }),
  define({
    name: "search_events",
    title: "ค้นหางาน",
    description: "ค้นหางานทั้งหมดด้วยคำค้น (ไม่จำกัดช่วงเวลา) เรียงจากใหม่ไปเก่า",
    schema: z.object({
      query: z.string().min(1).describe("คำค้น"),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ query, limit }, tz) => {
      const events = await repo.searchEvents(query, limit ?? 50);
      return { count: events.length, events: events.map((e) => fmtEvent(e, tz)) };
    },
  }),
  define({
    name: "create_event",
    title: "ลงงานใหม่",
    description:
      "เพิ่มงาน/นัดหมายลงปฏิทิน. เวลาที่ไม่มี offset ถือเป็นเวลาท้องถิ่น (ไทย +07:00). งานทั้งวันให้ใส่ all_day=true และ start เป็น YYYY-MM-DD. งานที่ซ้ำทุกสัปดาห์ (เช่น ยิมทุกจันทร์/พุธ/ศุกร์) ให้ใส่ repeat_days=[1,3,5] โดย start คือครั้งแรก. สิ่งที่ไม่มีเวลาแน่นอนให้ใช้ create_todo แทน",
    schema: eventCreateSchema,
    run: async (args, tz) => ({ created: fmtEvent(await repo.createEvent(args), tz) }),
  }),
  define({
    name: "update_event",
    title: "แก้ไขงาน",
    description:
      "แก้ไขงานตาม id (ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน; งานที่ทำซ้ำจะแก้ทั้งชุด). ถ้าเปลี่ยน start โดยไม่ส่ง end ระยะเวลาเดิมจะถูกคงไว้. ใช้ done=true เพื่อทำเครื่องหมายว่าเสร็จ",
    schema: eventUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }, tz) => {
      const e = await repo.updateEvent(id, rest);
      if (!e) throw new repo.InputError(`ไม่พบงาน id=${id}`);
      return { updated: fmtEvent(e, tz) };
    },
  }),
  define({
    name: "delete_event",
    title: "ลบงาน",
    description: "ลบงานตาม id อย่างถาวร (บันทึกที่ผูกไว้จะไม่ถูกลบ แค่ยกเลิกการผูก)",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteEvent(id))) throw new repo.InputError(`ไม่พบงาน id=${id}`);
      return { deleted: id };
    },
  }),
  define({
    name: "list_notes",
    title: "ดูบันทึก",
    description: "ดึงรายการบันทึก ค้นหาด้วยคำค้น วันที่ หรือ id ของงาน (แสดงตัวอย่างเนื้อหา; ใช้ get_note เพื่ออ่านทั้งหมด)",
    schema: z.object({
      query: z.string().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      event_id: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ query, date, event_id, limit }) => {
      const notes = await repo.listNotes({ q: query, date, eventId: event_id, limit: limit ?? 30 });
      return { count: notes.length, notes: notes.map((n) => fmtNote(n, false)) };
    },
  }),
  define({
    name: "get_note",
    title: "อ่านบันทึก",
    description: "อ่านบันทึกฉบับเต็มตาม id",
    schema: z.object({ id }),
    annotations: { readOnlyHint: true },
    run: async ({ id }) => {
      const n = await repo.getNote(id);
      if (!n) throw new repo.InputError(`ไม่พบบันทึก id=${id}`);
      return fmtNote(n);
    },
  }),
  define({
    name: "create_note",
    title: "จดบันทึก",
    description: "สร้างบันทึกใหม่ (รองรับ Markdown) ผูกกับวันที่หรืองานได้",
    schema: noteCreateSchema,
    run: async (args) => ({ created: fmtNote(await repo.createNote(args)) }),
  }),
  define({
    name: "update_note",
    title: "แก้ไขบันทึก",
    description: "แก้ไขบันทึกตาม id (ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน; content จะถูกแทนที่ทั้งหมด)",
    schema: noteUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const n = await repo.updateNote(id, rest);
      if (!n) throw new repo.InputError(`ไม่พบบันทึก id=${id}`);
      return { updated: fmtNote(n) };
    },
  }),
  define({
    name: "delete_note",
    title: "ลบบันทึก",
    description: "ลบบันทึกตาม id อย่างถาวร",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteNote(id))) throw new repo.InputError(`ไม่พบบันทึก id=${id}`);
      return { deleted: id };
    },
  }),
];

tools.push(
  define({
    name: "get_calendar_items",
    title: "task ที่ครบกำหนดและ milestone ในช่วงวันที่",
    description: "สิ่งที่ปรากฏบนปฏิทินนอกจาก event: task ที่มีกำหนดส่งและ milestone ของเป้าหมายในช่วง from–to (รวมวันปลาย YYYY-MM-DD) ใช้คู่กับ list_events เพื่อวางแผนสัปดาห์",
    schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    annotations: { readOnlyHint: true },
    run: async ({ from, to }) => {
      const c = await repo.getCalendarItems(from, to);
      return {
        tasks: c.tasks.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, done: t.done, priority: TODO_PRIORITIES[t.priority] ?? "none" })),
        milestones: c.milestones.map((m) => ({ id: m.id, title: m.title, goal: m.goal_title, due_date: m.due_date, done: m.done })),
      };
    },
  }),
  define({
    name: "get_analytics",
    title: "รีวิวสัปดาห์/เดือน (Analytics)",
    description:
      "ตัวเลขจริงของสัปดาห์ (จันทร์-อาทิตย์) หรือเดือน เทียบกับช่วงก่อนหน้า: งานที่เสร็จ/ครบกำหนดแล้วเสร็จ/ค้าง/เลยกำหนด, ความสม่ำเสมอของแต่ละ habit (ทำจากกี่วันที่ต้องทำ) พร้อม streak, milestone ที่เสร็จ และความคืบหน้าของเป้าหมาย ไม่มีคะแนนรวม ให้สรุปจากตัวเลขเหล่านี้เอง. offset=0 คือช่วงปัจจุบัน, -1 คือช่วงก่อนหน้า",
    schema: z.object({
      range: z.enum(["week", "month"]).optional().describe("ค่าเริ่มต้น week"),
      offset: z.number().int().min(-60).max(0).optional().describe("ย้อนกลับกี่ช่วง (0 = ช่วงนี้)"),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ range, offset }) => {
      const a = await repo.getAnalytics({ range, offset });
      const r = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
      return {
        period: { range: a.range, from: a.start, to: a.end, is_current: a.isCurrent, compared_with: `${a.prevStart} to ${a.prevEnd}` },
        tasks: {
          completed: a.tasks.completed,
          completed_previous_period: a.tasks.prevCompleted,
          created: a.tasks.created,
          due_in_period: { total: a.tasks.due.total, done: a.tasks.due.done, rate: r(a.tasks.due.rate) },
          due_in_previous_period: { total: a.tasks.prevDue.total, done: a.tasks.prevDue.done, rate: r(a.tasks.prevDue.rate) },
          open_now: a.tasks.open,
          overdue_now: a.tasks.overdue,
        },
        habits: {
          check_ins: a.habits.checkins,
          check_ins_previous_period: a.habits.prevCheckins,
          overall: { done: a.habits.done, scheduled: a.habits.scheduled, rate: r(a.habits.rate), previous_rate: r(a.habits.prevRate) },
          each: a.habits.list.map((h) => ({ title: h.title, done: h.done, scheduled: h.scheduled, rate: r(h.rate), current_streak: h.current_streak, longest_streak: h.longest_streak })),
        },
        goals: {
          active: a.goals.active,
          completed_in_period: a.goals.completed,
          milestones_done: a.goals.milestonesDone,
          milestones_done_previous_period: a.goals.prevMilestonesDone,
          progress_now: a.goals.progress.map((g) => ({ title: g.title, percent: g.percent === null ? null : Math.round(g.percent * 100), days_left: g.days_left, overdue: g.overdue })),
        },
        per_day: a.days.map((d) => ({ day: d.day, tasks_done: d.tasks, habit_check_ins: d.habits, milestones_done: d.milestones })),
      };
    },
  }),
  define({
    name: "list_goals",
    title: "ดูเป้าหมาย (Goals)",
    description: "รายการเป้าหมายพร้อมความคืบหน้า (นับ milestone และ task ที่ผูกไว้ ทำแล้วกี่จากกี่) วันที่เหลือ และจำนวนสิ่งที่ผูกไว้ ค่าเริ่มต้นแสดงเฉพาะที่ active/paused",
    schema: z.object({ status: z.enum(GOAL_STATUSES).optional(), include_inactive: z.boolean().optional() }),
    annotations: { readOnlyHint: true },
    run: async ({ status, include_inactive }) => {
      const goals = await repo.listGoals({ status, includeInactive: include_inactive });
      return { count: goals.length, goals: goals.map(fmtGoal) };
    },
  }),
  define({
    name: "get_goal",
    title: "ดูรายละเอียดเป้าหมาย",
    description: "เป้าหมายเดียวแบบละเอียด: milestones และ tasks/habits/events/notes ที่ผูกไว้ พร้อม streak ของ habits",
    schema: z.object({ id }),
    annotations: { readOnlyHint: true },
    run: async ({ id }) => {
      const g = await repo.getGoalDetail(id);
      if (!g) throw new repo.InputError(`ไม่พบเป้าหมาย id=${id}`);
      return fmtGoalDetail(g);
    },
  }),
  define({
    name: "create_goal",
    title: "สร้างเป้าหมาย",
    description: "สร้างเป้าหมาย (horizon: short/long) แล้วใช้ add_milestone และ link_to_goal เพื่อแตกเป็นหมุดหมายและผูกกับ task/habit/event/note ที่เกี่ยวข้อง",
    schema: goalCreateSchema,
    run: async (args) => ({ created: fmtGoal(await repo.createGoal(args)) }),
  }),
  define({
    name: "update_goal",
    title: "แก้ไขเป้าหมาย",
    description: "แก้ไขเป้าหมายตาม id (status: active/paused/done/cancelled)",
    schema: goalUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const g = await repo.updateGoal(id, rest);
      if (!g) throw new repo.InputError(`ไม่พบเป้าหมาย id=${id}`);
      return { updated: fmtGoal(g) };
    },
  }),
  define({
    name: "delete_goal",
    title: "ลบเป้าหมาย",
    description: "ลบเป้าหมายพร้อม milestones และการผูก (task/habit/event/note ที่ผูกไว้ไม่ถูกลบ)",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteGoal(id))) throw new repo.InputError(`ไม่พบเป้าหมาย id=${id}`);
      return { deleted: id };
    },
  }),
  define({
    name: "add_milestone",
    title: "เพิ่ม milestone",
    description: "เพิ่มหมุดหมายให้เป้าหมาย",
    schema: milestoneCreateSchema.extend({ goal_id: z.string().min(1) }),
    run: async ({ goal_id, ...rest }) => ({ created: await repo.addMilestone(goal_id, rest) }),
  }),
  define({
    name: "update_milestone",
    title: "แก้ไข/ติ๊ก milestone",
    description: "ติ๊กว่าสำเร็จ (done=true) หรือยกเลิก แก้ชื่อ/วันที่ของ milestone",
    schema: milestoneUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const m = await repo.updateMilestone(id, rest);
      if (!m) throw new repo.InputError(`ไม่พบ milestone id=${id}`);
      return { updated: { id: m.id, title: m.title, done: !!m.done_at, due_date: m.due_date } };
    },
  }),
  define({
    name: "delete_milestone",
    title: "ลบ milestone",
    description: "ลบ milestone ตาม id",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteMilestone(id))) throw new repo.InputError(`ไม่พบ milestone id=${id}`);
      return { deleted: id };
    },
  }),
  define({
    name: "link_to_goal",
    title: "ผูกกับเป้าหมาย",
    description: "ผูก task, habit, event หรือ note เข้ากับเป้าหมาย (ผูกซ้ำได้ไม่เป็นไร). task ที่ผูกไว้จะนับในความคืบหน้าของเป้าหมาย",
    schema: goalLinkSchema.extend({ goal_id: z.string().min(1) }),
    annotations: { idempotentHint: true },
    run: async ({ goal_id, ...rest }) => {
      await repo.linkToGoal(goal_id, rest);
      return { linked: { goal_id, ...rest } };
    },
  }),
  define({
    name: "unlink_from_goal",
    title: "เลิกผูกกับเป้าหมาย",
    description: "เลิกผูก (ไม่ลบ task/habit/event/note นั้น)",
    schema: goalLinkSchema.extend({ goal_id: z.string().min(1) }),
    annotations: { idempotentHint: true },
    run: async ({ goal_id, ...rest }) => {
      if (!(await repo.unlinkFromGoal(goal_id, rest))) throw new repo.InputError("ไม่พบการผูกนี้");
      return { unlinked: { goal_id, ...rest } };
    },
  }),
  define({
    name: "list_habits",
    title: "ดูนิสัย (Habits)",
    description:
      "รายการนิสัยที่ติดตามอยู่ พร้อม streak ปัจจุบัน/สูงสุด อัตราสำเร็จ 30 วัน และสถานะของสัปดาห์นี้ (ตัวเลขจริง ไม่ใช่คะแนน). ใช้ตอบเรื่องความสม่ำเสมอ",
    schema: z.object({ include_archived: z.boolean().optional() }),
    annotations: { readOnlyHint: true },
    run: async ({ include_archived }) => {
      const habits = await repo.getHabitsOverview({ includeArchived: include_archived });
      return { count: habits.length, habits: habits.map(fmtHabit) };
    },
  }),
  define({
    name: "create_habit",
    title: "สร้างนิสัยใหม่",
    description: "สร้างนิสัยที่อยากทำซ้ำ: schedule_type=daily (ทุกวัน) | weekdays (ใส่ weekdays เช่น [1,3,5]) | interval (ใส่ interval_days เช่น 3)",
    schema: habitCreateSchema as unknown as z.ZodObject,
    run: async (args) => {
      const h = await repo.createHabit(habitCreateSchema.parse(args));
      const [o] = (await repo.getHabitsOverview()).filter((x) => x.id === h.id);
      return { created: fmtHabit(o) };
    },
  }),
  define({
    name: "update_habit",
    title: "แก้ไขนิสัย",
    description: "แก้ไขนิสัยตาม id (ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน). archived=true เพื่อเก็บเข้าคลังโดยไม่ลบประวัติ",
    schema: habitUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const h = await repo.updateHabit(id, rest);
      if (!h) throw new repo.InputError(`ไม่พบนิสัย id=${id}`);
      const [o] = (await repo.getHabitsOverview({ includeArchived: true })).filter((x) => x.id === id);
      return { updated: fmtHabit(o) };
    },
  }),
  define({
    name: "check_in_habit",
    title: "เช็กอินนิสัย",
    description: "ทำเครื่องหมายว่าทำนิสัยนี้แล้ว (ค่าเริ่มต้นคือวันนี้; ใส่ day เพื่อย้อนหลัง; done=false เพื่อยกเลิก). เช็กอินล่วงหน้าไม่ได้",
    schema: checkinSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const r = await repo.setCheckin(id, rest);
      const [o] = (await repo.getHabitsOverview({ includeArchived: true })).filter((x) => x.id === id);
      return { day: r.day, done: r.done, habit: fmtHabit(o) };
    },
  }),
  define({
    name: "delete_habit",
    title: "ลบนิสัย",
    description: "ลบนิสัยและประวัติเช็กอินทั้งหมดอย่างถาวร (ถ้าแค่ไม่อยากเห็นให้ใช้ update_habit archived=true)",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteHabit(id))) throw new repo.InputError(`ไม่พบนิสัย id=${id}`);
      return { deleted: id };
    },
  }),
  define({
    name: "list_todos",
    title: "ดู To-do",
    description:
      "รายการสิ่งที่ต้องทำที่ไม่ผูกเวลา เรียงตามความสำคัญแล้วกำหนดส่ง. ค่าเริ่มต้นแสดงเฉพาะที่ยังไม่เสร็จ; กรองด้วย status (todo/doing/done), category, min_priority, หรือ parent_id เพื่อดูงานย่อย. ใช้ตอบ 'วันนี้ควรทำอะไรก่อน' ควบคู่กับ get_summary",
    schema: z.object({
      include_done: z.boolean().optional().describe("รวมที่เสร็จแล้ว"),
      query: z.string().optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      category: z.string().optional().describe("ชื่อหมวดหมู่"),
      min_priority: z.enum(["low", "medium", "high"]).optional().describe("เฉพาะงานที่ priority ตั้งแต่ระดับนี้ขึ้นไป"),
      parent_id: z.string().optional().describe("ดูเฉพาะงานย่อยของงานนี้"),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ include_done, query, status, category, min_priority, parent_id }) => {
      const todos = await repo.listTodos({
        includeDone: include_done,
        q: query,
        status,
        category,
        minPriority: min_priority ? TODO_PRIORITIES.indexOf(min_priority) : undefined,
        parentId: parent_id,
      });
      const categories = (await repo.listCategories()).map((c) => c.name);
      return { count: todos.length, categories, todos: todos.map(fmtTodo) };
    },
  }),
  define({
    name: "create_todo",
    title: "เพิ่ม To-do",
    description: "เพิ่มสิ่งที่ต้องทำที่ไม่มีเวลาแน่นอน (กำหนดส่งเป็นวันที่ได้ ไม่บังคับ) ตั้ง priority, category ได้ และใส่ parent_id เพื่อสร้างงานย่อย. ถ้ามีวันเวลาชัดเจนให้ใช้ create_event",
    schema: todoCreateSchema,
    run: async (args) => ({ created: fmtTodo(await repo.createTodo(args)) }),
  }),
  define({
    name: "update_todo",
    title: "แก้ไข To-do",
    description: "แก้ไข To-do ตาม id: status (todo/doing/done) หรือ done=true เมื่อทำเสร็จ, priority (none/low/medium/high), category, due_date",
    schema: todoUpdateSchema.extend({ id }),
    annotations: { idempotentHint: true },
    run: async ({ id, ...rest }) => {
      const t = await repo.updateTodo(id, rest);
      if (!t) throw new repo.InputError(`ไม่พบ To-do id=${id}`);
      return { updated: fmtTodo(t) };
    },
  }),
  define({
    name: "delete_todo",
    title: "ลบ To-do",
    description: "ลบ To-do ตาม id อย่างถาวร",
    schema: z.object({ id }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ id }) => {
      if (!(await repo.deleteTodo(id))) throw new repo.InputError(`ไม่พบ To-do id=${id}`);
      return { deleted: id };
    },
  }),
  define({
    name: "list_messages",
    title: "อ่านข้อความติดต่อ",
    description:
      "ข้อความที่คนส่งมาจากฟอร์มติดต่อบนหน้า Portfolio (บริษัทเรื่องฝึกงาน หรือลูกค้าฟรีแลนซ์) เรียงใหม่ไปเก่า พร้อมจำนวนที่ยังไม่อ่าน",
    schema: z.object({
      unread_only: z.boolean().optional().describe("เฉพาะที่ยังไม่อ่าน"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ unread_only, limit }, tz) => {
      const r = await listMessages({ unreadOnly: unread_only, limit: limit ?? 20 });
      return {
        unread: r.unread,
        messages: r.messages.map((m) => ({ ...m, created_at: formatLocal(m.created_at, tz) })),
      };
    },
  }),
  define({
    name: "get_portfolio_stats",
    title: "สถิติคนเปิดหน้า Portfolio",
    description: "จำนวนคนเปิดหน้า Portfolio (นับต่อหน้า ไม่ใช้ cookie ไม่นับบอทและเจ้าของเว็บ) แยกรายวัน ภาษา เว็บที่ลิงก์มา และประเทศ",
    schema: z.object({ days: z.number().int().min(1).max(90).optional().describe("ย้อนหลังกี่วัน (ค่าเริ่มต้น 14)") }),
    annotations: { readOnlyHint: true },
    run: async ({ days }) => getVisitStats((await getEnv()).DB, days ?? 14),
  }),
  define({
    name: "mark_message_read",
    title: "ทำเครื่องหมายว่าอ่านแล้ว",
    description: "ทำเครื่องหมายข้อความติดต่อว่าอ่านแล้ว (หรือยังไม่อ่าน) ตาม id",
    schema: z.object({ id, read: z.boolean().optional().describe("ค่าเริ่มต้น true") }),
    annotations: { idempotentHint: true },
    run: async ({ id, read }) => {
      if (!(await setMessageRead(id, read ?? true))) throw new repo.InputError(`ไม่พบข้อความ id=${id}`);
      return { id, read: read ?? true };
    },
  }),
);

export function toolList() {
  return tools.map((t) => {
    const inputSchema = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    delete inputSchema.$schema;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      ...(t.annotations ? { annotations: { title: t.title, ...t.annotations } } : {}),
    };
  });
}
