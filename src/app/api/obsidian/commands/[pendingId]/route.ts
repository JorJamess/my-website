import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/server/http";
import { previewCommand } from "@/modules/obsidian/commands";
import { readDocument, sharedDocByPath } from "@/modules/obsidian/documents";
import { lineDiff } from "@/lib/obsidian/diff";

type Ctx = { params: Promise<{ pendingId: string }> };

/** The exact proposal (path, full content or diff) for the owner to read before approving. */
export const GET = api<Ctx>(async (_req, { params }) => {
  const p = await previewCommand((await params).pendingId);
  if (!p) return notFound();
  // for an edit, show what changes compared with the synced copy of the note
  let diff: string | null = null;
  const pl = p.payload as { path?: string; new_content?: string } | null;
  if (p.op === "edit_note" && pl?.path && typeof pl.new_content === "string") {
    const doc = await sharedDocByPath(pl.path);
    const cur = doc ? await readDocument(doc.id, { max_chars: 40_000 }) : null;
    if (cur && !cur.truncated) diff = lineDiff(cur.chunks.map((c) => c.content).join(""), pl.new_content);
  }
  return NextResponse.json({ ...p, diff });
});
