import "server-only";
// Compatibility barrel: the code lives in src/modules/*. Existing imports of "@/lib/server/repo" keep working.
export { InputError } from "@/modules/core";
export * from "@/modules/events/repo";
export * from "@/modules/notes/repo";
export * from "@/modules/tasks/repo";
export * from "@/modules/summary/repo";
export * from "@/modules/habits/repo";
export * from "@/modules/goals/repo";
export * from "@/modules/analytics/repo";
export * from "@/modules/settings/repo";
export * from "@/modules/calendar/repo";
