import { beforeEach, describe, expect, it } from "vitest";
import { toolList, tools } from "@/lib/server/mcp/tools";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const tool = tools.find((t) => t.name === name)!;
  const parsed = tool.schema.parse(args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await tool.run(parsed as never, "+07:00")) as Record<string, any>;
}

describe("MCP tool list", () => {
  it("builds a JSON schema for every tool and has unique names", () => {
    const list = toolList();
    expect(new Set(list.map((t) => t.name)).size).toBe(list.length);
    for (const n of ["list_habits", "create_habit", "update_habit", "check_in_habit", "delete_habit", "list_todos", "create_todo"]) {
      expect(list.some((t) => t.name === n)).toBe(true);
    }
    for (const t of list) expect(t.inputSchema).toBeTruthy();
  });
});

describe("habit tools", () => {
  it("creates, checks in, summarises and deletes", async () => {
    const created = await call("create_habit", { title: "Read", schedule_type: "daily" });
    const id = created.created.id as string;
    expect(created.created.done_today).toBe(false);

    const ci = await call("check_in_habit", { id });
    expect(ci.done).toBe(true);
    expect(ci.habit.current_streak).toBe(1);

    const summary = await call("get_summary");
    expect(summary.habits_today).toEqual([{ id, title: "Read", done: true, current_streak: 1 }]);

    const list = await call("list_habits");
    expect(list.habits[0].this_week.length).toBe(7);

    expect((await call("delete_habit", { id })).deleted).toBe(id);
  });
  it("rejects an invalid schedule with a clear message", async () => {
    await expect(call("create_habit", { title: "x", schedule_type: "weekdays" })).rejects.toThrow();
  });
  it("refuses a future check-in", async () => {
    const id = (await call("create_habit", { title: "x", schedule_type: "daily" })).created.id;
    await expect(call("check_in_habit", { id, day: "2999-01-01" })).rejects.toThrow();
  });
});
