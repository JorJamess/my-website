import "server-only";
import { ZodError } from "zod";
import * as repo from "@/lib/server/repo";
import { ctx } from "@/modules/core";
import type { ActionRisk, PendingAction } from "@/lib/types";
import { tools } from "./tools";

/**
 * Claude's tools split three ways:
 *  - reads and creating new things run at once;
 *  - ticking something done runs at once too (small, easy to undo);
 *  - deletes, edits to existing items and links wait for the owner's yes in the app.
 * Every change that does run is written to the audit log.
 */
const DELETES = new Set(["delete_event", "delete_note", "delete_todo", "delete_goal", "delete_milestone", "delete_habit"]);
const EDITS = new Set(["update_event", "update_note", "update_todo", "update_goal", "update_milestone", "update_habit", "skip_event_occurrence", "restore_event_occurrence"]);
const LINKS = new Set(["link_note", "unlink_note", "link_to_goal", "unlink_from_goal"]);
/** an update that only ticks things done/undone is not gated */
const TICK_ONLY: Record<string, string[]> = {
  update_todo: ["id", "done", "status"],
  update_event: ["id", "done"],
  update_milestone: ["id", "done"],
};

export function riskOf(tool: string, args: Record<string, unknown>): ActionRisk | null {
  if (DELETES.has(tool)) return "delete";
  if (LINKS.has(tool)) return "link";
  if (EDITS.has(tool)) {
    const tick = TICK_ONLY[tool];
    if (tick && Object.keys(args).every((k) => tick.includes(k))) return null;
    return "edit";
  }
  return null;
}

const LABEL: Record<string, string> = { event: "event", note: "note", todo: "task", goal: "goal", milestone: "milestone", habit: "habit" };

async function titleOf(kind: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string") return null;
  try {
    if (kind === "event") return (await repo.getEvent(id))?.title ?? null;
    if (kind === "note") return (await repo.getNote(id))?.title ?? null;
    if (kind === "todo") return (await repo.getTodo(id))?.title ?? null;
    if (kind === "goal") return (await repo.getGoal(id))?.title ?? null;
    if (kind === "habit") return (await repo.getHabit(id))?.title ?? null;
  } catch {}
  return null;
}

const short = (v: unknown) => {
  let s = typeof v === "string" ? v : JSON.stringify(v);
  // 2026-11-14T10:00:00+07:00 reads better as 2026-11-14 10:00
  s = s.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/, "$1 $2");
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/** One plain-English line for the approvals page, e.g. Delete note “Old groceries”. */
export async function describeAction(tool: string, args: Record<string, unknown>): Promise<string> {
  const [verb, ...rest] = tool.split("_");
  const kind = rest.join("_");
  if (verb === "delete" && LABEL[kind]) {
    const t = await titleOf(kind, args.id);
    return `Delete ${LABEL[kind]}${t ? ` “${t}”` : ""}`;
  }
  if (verb === "update" && LABEL[kind]) {
    const t = await titleOf(kind, args.id);
    const changes = Object.entries(args).filter(([k]) => k !== "id").map(([k, v]) => `${k.replace(/_/g, " ")} → ${short(v)}`);
    return `Edit ${LABEL[kind]}${t ? ` “${t}”` : ""}: ${changes.join(", ") || "no changes"}`;
  }
  if (tool === "skip_event_occurrence" || tool === "restore_event_occurrence") {
    const t = await titleOf("event", args.id);
    return `${tool === "skip_event_occurrence" ? "Skip" : "Restore"} one repeat of event${t ? ` “${t}”` : ""} on ${short(args.day)}`;
  }
  if (tool === "link_note" || tool === "unlink_note") {
    const t = await titleOf("note", args.id);
    return `${tool === "link_note" ? "Link" : "Unlink"} note${t ? ` “${t}”` : ""} ${tool === "link_note" ? "to" : "from"} a ${short(args.entity_type)}`;
  }
  if (tool === "link_to_goal" || tool === "unlink_from_goal") {
    const t = await titleOf("goal", args.goal_id);
    return `${tool === "link_to_goal" ? "Link" : "Unlink"} a ${short(args.entity_type)} ${tool === "link_to_goal" ? "to" : "from"} goal${t ? ` “${t}”` : ""}`;
  }
  return `${tool} ${short(args)}`;
}

/** What Claude is told when its request was queued instead of run. */
export function queuedReply(p: PendingAction) {
  return {
    queued: true,
    pending_id: p.id,
    summary: p.summary,
    message: "ยังไม่ได้ทำ: ต้องรอเจ้าของกดอนุมัติในหน้า Approvals ของแอปก่อน บอกเจ้าของว่ามีรายการรออนุมัติอยู่ อย่าลองเรียกซ้ำ",
  };
}

/** Run a queued action now (the owner said yes). */
export async function approvePending(id: string, tz: string): Promise<PendingAction | null> {
  const p = await repo.getPending(id);
  if (!p || p.status !== "pending") return null;
  const tool = tools.find((t) => t.name === p.tool);
  // claim it first so a double click can't run it twice
  const claimed = await repo.decide(id, "approved");
  if (!claimed) return null;
  try {
    if (!tool) throw new repo.InputError(`Unknown tool ${p.tool}`);
    const args = tool.schema.parse(p.args);
    await tool.run(args as never, tz);
    await repo.logAudit({ actor: "you", action: "approve", summary: `Approved: ${p.summary}`, pendingId: id });
    return claimed;
  } catch (err) {
    const msg = err instanceof ZodError ? "The request is no longer valid" : err instanceof repo.InputError ? err.message : "Something went wrong";
    if (!(err instanceof repo.InputError) && !(err instanceof ZodError)) console.error("[approve]", err);
    const { db } = await ctx();
    await db.prepare("UPDATE pending_actions SET status = 'failed', note = ? WHERE id = ?").bind(msg, id).run();
    await repo.logAudit({ actor: "you", action: "approve", summary: `Couldn't apply: ${p.summary} (${msg})`, ok: false, pendingId: id });
    return (await repo.getPending(id))!;
  }
}

export async function rejectPending(id: string): Promise<PendingAction | null> {
  const p = await repo.decide(id, "rejected");
  if (p) await repo.logAudit({ actor: "you", action: "reject", summary: `Rejected: ${p.summary}`, pendingId: id });
  return p;
}

/** A line for the activity log about something Claude just did without asking. */
export async function describeRun(tool: string, args: Record<string, unknown>): Promise<string> {
  const title = typeof args.title === "string" ? ` “${args.title}”` : "";
  if (tool.startsWith("create_")) return `Created ${LABEL[tool.slice(7)] ?? tool.slice(7)}${title}`;
  if (tool === "add_milestone") return `Added milestone${title}`;
  if (tool === "check_in_habit") {
    const t = await titleOf("habit", args.id);
    return `Checked in habit${t ? ` “${t}”` : ""}${typeof args.day === "string" ? ` for ${args.day}` : ""}`;
  }
  if (tool === "mark_message_read") return "Marked a message as read";
  if (tool.startsWith("update_")) return (await describeAction(tool, args)).replace(/^Edit/, "Updated");
  return `${tool} ${short(args)}`;
}
