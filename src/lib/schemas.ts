import { z } from "zod";
import { EVENT_COLORS } from "./types";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const repeatDays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

const dateTime = z
  .string()
  .min(10)
  .describe(
    'วันเวลา เช่น "2026-11-08 14:30" (ถือเป็นเวลาไทย), "2026-11-08" (ทั้งวัน) หรือ ISO-8601 ที่มี offset',
  );

export const eventCreateSchema = z.object({
  title: z.string().min(1).max(200).describe("ชื่องาน/กิจกรรม"),
  start: dateTime.describe("เวลาเริ่ม เช่น 2026-11-08 14:30"),
  end: dateTime.optional().describe("เวลาสิ้นสุด (ไม่บังคับ)"),
  all_day: z.boolean().optional().describe("เป็นงานทั้งวันหรือไม่"),
  description: z.string().max(5000).optional().describe("รายละเอียด"),
  location: z.string().max(300).optional().describe("สถานที่"),
  color: z.enum(EVENT_COLORS).optional().describe("สีป้ายกำกับ"),
  repeat_days: repeatDays.optional().describe("ทำซ้ำทุกสัปดาห์ในวันเหล่านี้ (0=อาทิตย์ … 6=เสาร์) เช่น [1,3,5] = จันทร์/พุธ/ศุกร์; วันเริ่มคือครั้งแรก"),
  repeat_until: dateKey.optional().describe("ทำซ้ำถึงวันที่ (รวมวันนี้) YYYY-MM-DD; ไม่ใส่ = ไม่มีวันสิ้นสุด"),
});

export const eventUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  start: dateTime.optional(),
  end: dateTime.nullable().optional().describe("ส่ง null เพื่อลบเวลาสิ้นสุด"),
  all_day: z.boolean().optional(),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  color: z.enum(EVENT_COLORS).optional(),
  done: z.boolean().optional().describe("ทำเสร็จแล้วหรือยัง"),
  repeat_days: repeatDays.nullable().optional().describe("วันที่ทำซ้ำทุกสัปดาห์ (0=อาทิตย์ … 6=เสาร์); ส่ง null เพื่อเลิกทำซ้ำ"),
  repeat_until: dateKey.nullable().optional().describe("ทำซ้ำถึงวันที่ YYYY-MM-DD; null = ไม่มีวันสิ้นสุด"),
});

const priorityName = z.enum(["none", "low", "medium", "high"]);
const todoStatus = z.enum(["todo", "doing", "done"]);

export const todoCreateSchema = z.object({
  title: z.string().min(1).max(200).describe("สิ่งที่ต้องทำ เช่น ส่งการบ้าน Java"),
  note: z.string().max(5000).optional().describe("รายละเอียดเพิ่มเติม"),
  due_date: dateKey.optional().describe("กำหนดส่ง YYYY-MM-DD (ไม่บังคับ)"),
  priority: priorityName.optional().describe("none | low | medium | high"),
  status: todoStatus.optional().describe("todo | doing | done"),
  category: z.string().min(1).max(60).nullable().optional().describe("ชื่อหมวดหมู่ เช่น Study (สร้างให้อัตโนมัติถ้ายังไม่มี)"),
  parent_id: z.string().optional().describe("id ของงานแม่ ถ้านี่คืองานย่อย (ซ้อนได้ชั้นเดียว)"),
  important: z.boolean().optional().describe("เหมือน priority=high (ใช้ priority แทน)"),
});

export const todoUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  note: z.string().max(5000).nullable().optional(),
  due_date: dateKey.nullable().optional().describe("ส่ง null เพื่อลบกำหนดส่ง"),
  priority: priorityName.optional(),
  status: todoStatus.optional().describe("todo | doing | done"),
  category: z.string().min(1).max(60).nullable().optional().describe("ชื่อหมวดหมู่; null เพื่อเอาออก"),
  important: z.boolean().optional(),
  done: z.boolean().optional().describe("ทำเสร็จแล้วหรือยัง"),
});

export const categorySchema = z.object({
  name: z.string().min(1).max(60),
  color: z.enum(EVENT_COLORS).optional(),
});

export const noteCreateSchema = z.object({
  title: z.string().min(1).max(200).describe("หัวข้อบันทึก"),
  content: z.string().max(50000).optional().describe("เนื้อหา (รองรับ Markdown)"),
  note_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("ผูกกับวันที่ YYYY-MM-DD (ไม่บังคับ)"),
  event_id: z.string().optional().describe("ผูกกับ id ของงาน (ไม่บังคับ)"),
  pinned: z.boolean().optional().describe("ปักหมุดไว้ด้านบน"),
});

export const noteUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  event_id: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

const habitBase = {
  title: z.string().min(1).max(200).describe("ชื่อนิสัย เช่น อ่านหนังสือ 20 นาที"),
  description: z.string().max(2000).nullable().optional(),
  color: z.enum(EVENT_COLORS).optional(),
  schedule_type: z.enum(["daily", "weekdays", "interval"]).describe("daily = ทุกวัน, weekdays = เลือกวันในสัปดาห์, interval = ทุก N วัน"),
  weekdays: repeatDays.nullable().optional().describe("ใช้กับ weekdays: 0=อาทิตย์ … 6=เสาร์"),
  interval_days: z.number().int().min(2).max(365).nullable().optional().describe("ใช้กับ interval: ทำทุกกี่วัน"),
  start_date: dateKey.optional().describe("วันที่เริ่มนับ YYYY-MM-DD (ค่าเริ่มต้น = วันนี้)"),
};

/** weekdays needs weekdays, interval needs interval_days */
export function checkHabitSchedule(h: { schedule_type: string; weekdays?: number[] | null; interval_days?: number | null }) {
  if (h.schedule_type === "weekdays" && !h.weekdays?.length) return "Pick at least one day of the week";
  if (h.schedule_type === "interval" && !h.interval_days) return "Say how many days apart (2 or more)";
  return null;
}

export const habitCreateSchema = z.object(habitBase).superRefine((h, ctx) => {
  const err = checkHabitSchedule(h);
  if (err) ctx.addIssue({ code: "custom", message: err, path: [h.schedule_type === "weekdays" ? "weekdays" : "interval_days"] });
});

export const habitUpdateSchema = z.object({
  title: habitBase.title.optional(),
  description: habitBase.description,
  color: habitBase.color,
  schedule_type: habitBase.schedule_type.optional(),
  weekdays: habitBase.weekdays,
  interval_days: habitBase.interval_days,
  start_date: habitBase.start_date,
  archived: z.boolean().optional().describe("true = เก็บเข้าคลัง (ไม่แสดงแต่ไม่ลบประวัติ), false = นำกลับมา"),
});

export const checkinSchema = z.object({
  day: dateKey.optional().describe("วันที่ YYYY-MM-DD (ค่าเริ่มต้น = วันนี้; ย้อนหลังได้ แต่ล่วงหน้าไม่ได้)"),
  done: z.boolean().optional().describe("ค่าเริ่มต้น true; false = ยกเลิกการเช็กอินวันนั้น"),
  note: z.string().max(500).nullable().optional(),
});

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type TodoCreateInput = z.infer<typeof todoCreateSchema>;
export type TodoUpdateInput = z.infer<typeof todoUpdateSchema>;
export type HabitCreateInput = z.infer<typeof habitCreateSchema>;
export type HabitUpdateInput = z.infer<typeof habitUpdateSchema>;
export type CheckinInput = z.infer<typeof checkinSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
