import { z } from "zod";
import { EVENT_COLORS } from "./types";

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

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
