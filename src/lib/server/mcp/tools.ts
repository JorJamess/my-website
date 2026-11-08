import "server-only";
import { z } from "zod";
import {
  eventCreateSchema,
  eventUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
} from "@/lib/schemas";
import * as repo from "@/lib/server/repo";
import { addDaysKey, formatLocal, localDateKey } from "@/lib/time";
import type { CalendarEvent, Note } from "@/lib/types";

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
  };
  return {
    ...base,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
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
      "สรุปภาพรวม: งานวันนี้, งานที่กำลังจะมาถึงใน N วัน, งานที่เลยกำหนดแต่ยังไม่เสร็จ, บันทึกล่าสุด และสถิติสัปดาห์/เดือน",
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
      "เพิ่มงาน/นัดหมายลงปฏิทิน. เวลาที่ไม่มี offset ถือเป็นเวลาท้องถิ่น (ไทย +07:00). งานทั้งวันให้ใส่ all_day=true และ start เป็น YYYY-MM-DD",
    schema: eventCreateSchema,
    run: async (args, tz) => ({ created: fmtEvent(await repo.createEvent(args), tz) }),
  }),
  define({
    name: "update_event",
    title: "แก้ไขงาน",
    description:
      "แก้ไขงานตาม id (ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน). ถ้าเปลี่ยน start โดยไม่ส่ง end ระยะเวลาเดิมจะถูกคงไว้. ใช้ done=true เพื่อทำเครื่องหมายว่าเสร็จ",
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
