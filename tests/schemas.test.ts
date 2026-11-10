import { describe, expect, it } from "vitest";
import { eventCreateSchema, eventUpdateSchema, noteCreateSchema, todoCreateSchema, todoUpdateSchema } from "@/lib/schemas";

describe("schemas", () => {
  it("accepts a minimal event", () => {
    expect(eventCreateSchema.safeParse({ title: "x", start: "2026-11-08 14:30" }).success).toBe(true);
  });
  it("rejects an empty title and unknown colours", () => {
    expect(eventCreateSchema.safeParse({ title: "", start: "2026-11-08" }).success).toBe(false);
    expect(eventCreateSchema.safeParse({ title: "x", start: "2026-11-08", color: "teal" }).success).toBe(false);
  });
  it("validates repeat days", () => {
    const ok = eventCreateSchema.safeParse({ title: "x", start: "2026-11-08", repeat_days: [1, 3] });
    expect(ok.success).toBe(true);
    expect(eventCreateSchema.safeParse({ title: "x", start: "2026-11-08", repeat_days: [7] }).success).toBe(false);
    expect(eventCreateSchema.safeParse({ title: "x", start: "2026-11-08", repeat_days: [] }).success).toBe(false);
    expect(eventCreateSchema.safeParse({ title: "x", start: "2026-11-08", repeat_until: "tomorrow" }).success).toBe(false);
  });
  it("lets an update clear repeat with null", () => {
    expect(eventUpdateSchema.safeParse({ repeat_days: null, repeat_until: null }).success).toBe(true);
  });
  it("limits note and todo sizes", () => {
    expect(noteCreateSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(todoCreateSchema.safeParse({ title: "Java", due_date: "2026-11-10" }).success).toBe(true);
    expect(todoCreateSchema.safeParse({ title: "Java", due_date: "10/11/2026" }).success).toBe(false);
    expect(todoUpdateSchema.safeParse({ due_date: null, done: true }).success).toBe(true);
  });
});
