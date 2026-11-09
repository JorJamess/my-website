"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/use-data";
import { cn } from "@/lib/utils";
import { Pupu } from "./pupu";
import { AddTodo, TodoItem } from "./todo-list";

export function TodosView() {
  const [showDone, setShowDone] = useState(false);
  const { data, loading, error } = useData(() => api.todos(true), []);
  const open = data?.filter((t) => !t.done) ?? [];
  const done = data?.filter((t) => t.done) ?? [];

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="border-b pb-6">
        <h1 className="text-[28px] font-semibold tracking-tight">To do</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Tasks without a fixed time. Ask Claude “what should I do first today?” and it reads this list.
        </p>
      </header>

      <div className="py-5">
        <AddTodo autoFocus />
      </div>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : open.length ? (
        <ul className="border-b">
          {open.map((t) => (
            <TodoItem key={t.id} todo={t} />
          ))}
        </ul>
      ) : (
        <div className="group/pupu flex items-center gap-3 py-4">
          <Pupu size={56} pose={done.length ? "cheer" : "sleepy"} />
          <p className="text-[15px] text-muted-foreground">
            {done.length ? "Everything is done. Nice work!" : "Nothing to do yet. Add your first task above."}
          </p>
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showDone ? "Hide" : "Show"} completed ({done.length})
          </button>
          <ul className={cn("mt-2 border-b", !showDone && "hidden")}>
            {done.map((t) => (
              <TodoItem key={t.id} todo={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
