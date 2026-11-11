import "server-only";
import { z } from "zod";
import * as repo from "@/lib/server/repo";
import { getObsidianStatus, pairedVaultName, readDocument, searchKnowledge, sharedDocByPath, sharedDocsUnder, type SharedDoc } from "@/modules/obsidian/documents";
import { queueVaultProposal, VAULT_OPS, type VaultOp } from "@/modules/obsidian/commands";

/**
 * Claude's Obsidian tools. Reads only ever see documents the owner chose to share (lifeos_sync: true) and that are
 * still shared. Proposals never change anything: each one becomes an approval request, and only the Mac can apply it.
 */
type Def = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run: (args: never, tz: string) => Promise<unknown>;
};
function define<S extends z.ZodObject>(d: Omit<Def, "schema" | "run"> & { schema: S; run: (args: z.infer<S>) => Promise<unknown> }): Def {
  return d as unknown as Def;
}

const obsidianLink = (vault: string | null, path: string) => (vault ? `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}` : null);
const COVERAGE_NOTE = "มีเฉพาะโน้ตและ PDF ที่เจ้าของเลือกแชร์ (lifeos_sync: true) และซิงก์ขึ้นมาแล้วเท่านั้น โน้ตอื่นในเครื่องของเจ้าของ Claude มองไม่เห็น อย่าสรุปว่า 'ไม่มีโน้ตเรื่องนี้' ให้บอกว่า 'ไม่พบในโน้ตที่ซิงก์'. ตอบโดยอ้างชื่อโน้ต/PDF พร้อม path (และหน้าสำหรับ PDF) ที่ได้จากผลลัพธ์ และอย่าบอกว่าสรุปคือต้นฉบับครบถ้วน";

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const queuedReply = (q: { pending_id: string; summary: string }) => ({
  queued: true,
  pending_id: q.pending_id,
  summary: q.summary,
  message: "ยังไม่ได้ทำ: สร้างคำขอรออนุมัติแล้ว เจ้าของต้องกดอนุมัติในหน้า Approvals ของ LifeOS จากนั้นต้องรอให้ Mac ของเจ้าของออนไลน์เพื่อทำจริง บอกเจ้าของว่ามีรายการรออนุมัติ อย่าเรียกซ้ำ",
});

const path = z.string().min(1).max(400).describe("path ภายใน vault เช่น Programming/Web/REST API.md (ใช้ / และไม่ขึ้นต้นด้วย /)");
const folder = z.string().min(1).max(400).describe("path ของโฟลเดอร์ภายใน vault เช่น Programming/Java");
const hash = z.string().min(8).max(128).describe("content_hash ที่ได้จาก read_obsidian_note ตอนอ่านโน้ตนั้น");
const docId = z.string().min(8).max(80).describe("document_id จากผลค้นหา");

async function mustBeShared(p: string): Promise<SharedDoc> {
  const d = await sharedDocByPath(p);
  if (!d || d.kind !== "note") throw new repo.InputError("ไม่พบโน้ตที่ซิงก์ใน path นี้ (Claude เห็นเฉพาะโน้ตที่เจ้าของแชร์) ลองค้นด้วย search_obsidian_knowledge ก่อน");
  return d;
}
async function mustNotExist(p: string) {
  if (await sharedDocByPath(p)) throw new repo.InputError(`มีโน้ตอยู่ที่ ${p} แล้ว ระบบไม่เขียนทับและไม่ตั้งชื่อเลขให้เอง ให้เสนอชื่อหรือโฟลเดอร์อื่น`);
}
async function mustHaveShared(f: string) {
  // the owner is shown how many shared notes a folder change affects, so count them all (not just the first page)
  const docs = await sharedDocsUnder(f, 20_000);
  if (!docs.length) throw new repo.InputError("ไม่พบโน้ตที่ซิงก์ในโฟลเดอร์นี้ (Claude เห็นเฉพาะโฟลเดอร์ที่มีโน้ตที่เจ้าของแชร์)");
  return docs;
}
const sameParent = (a: string, b: string) => parentOf(a).toLowerCase() === parentOf(b).toLowerCase();
const sameName = (a: string, b: string) => nameOf(a).toLowerCase() === nameOf(b).toLowerCase();

async function folderImpact(docs: SharedDoc[]) {
  const notes = docs.filter((d) => d.kind === "note");
  return { synced_notes: notes.length, synced_pdfs: docs.length - notes.length, synced_note_paths: notes.slice(0, 50).map((d) => d.path), more_synced_notes: Math.max(0, notes.length - 50) };
}

function propose(op: VaultOp, title: string, description: string, shape: z.ZodRawShape, build: (a: Record<string, string | undefined>) => Promise<{ payload: Record<string, unknown>; summary: string }>): Def {
  return define({
    name: `propose_${op}`,
    title,
    description: `${description} ไม่ได้แก้อะไรทันที: สร้างคำขอรออนุมัติ เจ้าของต้องกดอนุมัติใน LifeOS แล้ว Mac ถึงจะทำให้ (หมดอายุใน ${VAULT_OPS[op].ttl >= 86400 ? `${VAULT_OPS[op].ttl / 86400} วัน` : `${VAULT_OPS[op].ttl / 3600} ชั่วโมง`} หลังอนุมัติถ้า Mac ไม่ออนไลน์)`,
    schema: z.object(shape),
    run: async (args: Record<string, string | undefined>) => {
      const { payload, summary } = await build(args);
      return queuedReply(await queueVaultProposal({ op, payload, summary }));
    },
  } as never);
}

const note = (p: string) => `“${p}”`;

export const obsidianTools: Def[] = [
  define({
    name: "search_obsidian_knowledge",
    title: "ค้นความรู้ใน Obsidian",
    description: `ค้นโน้ตและข้อความ PDF จาก Obsidian ที่ซิงก์แล้ว (ไทย อังกฤษ ญี่ปุ่น และโค้ด; คำค้นสั้นกว่า 3 ตัวอักษรค้นได้แต่ช้ากว่าและครอบคลุมเฉพาะส่วนล่าสุด). ใช้ได้แม้ Mac ปิดอยู่ ${COVERAGE_NOTE}`,
    schema: z.object({
      query: z.string().min(1).max(200).describe("คำค้น"),
      type: z.enum(["note", "pdf"]).optional().describe("จำกัดเฉพาะโน้ตหรือ PDF"),
      tag: z.string().max(60).optional().describe("แท็กที่ตรงทั้งคำ"),
      sort: z.enum(["relevance", "date"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ query, type, tag, sort, limit, offset }) => {
      const r = await searchKnowledge({ q: query, kind: type, tag, sort, limit, offset });
      const vault = await pairedVaultName();
      return {
        coverage: "ผลจากเฉพาะโน้ต/PDF ที่ซิงก์แล้ว",
        total: r.total,
        truncated: r.truncated,
        results: r.results.map((h) => ({
          document_id: h.document_id,
          title: h.title,
          type: h.kind,
          source_path: h.path,
          obsidian_link: obsidianLink(vault, h.path),
          tags: h.tags,
          updated_at: h.updated_at,
          ...(h.kind === "pdf" ? { page: h.page } : { section: h.heading }),
          chunk_index: h.chunk_index,
          excerpt: h.excerpt,
        })),
      };
    },
  }),
  define({
    name: "read_obsidian_note",
    title: "อ่านโน้ต Obsidian",
    description: `อ่านเนื้อหาโน้ตที่ซิงก์แล้วตาม document_id (ได้จาก search_obsidian_knowledge). คืนเป็นช่วงๆ ถ้ายาวจะมี truncated และ next_chunk ให้เรียกต่อด้วย from_chunk. content_hash ใช้กับ propose_edit_note. ${COVERAGE_NOTE}`,
    schema: z.object({ id: docId, from_chunk: z.number().int().min(0).optional(), max_chars: z.number().int().min(500).max(40000).optional() }),
    annotations: { readOnlyHint: true },
    run: async ({ id, from_chunk, max_chars }) => {
      const r = await readDocument(id, { from_chunk, max_chars });
      if (!r) throw new repo.InputError("ไม่พบโน้ตนี้ในโน้ตที่ซิงก์ (อาจไม่ได้แชร์ ถูกลบ หรือถูกถอนสิทธิ์)");
      if (r.document.kind !== "note") throw new repo.InputError("นี่คือ PDF ใช้ read_obsidian_pdf แทน");
      const vault = await pairedVaultName();
      return {
        document_id: r.document.id,
        title: r.document.title,
        type: "note",
        source_path: r.document.path,
        obsidian_link: obsidianLink(vault, r.document.path),
        tags: r.document.tags,
        updated_at: r.document.updated_at,
        synced_at: r.document.synced_at,
        content_hash: r.document.content_hash,
        content: r.chunks.map((c) => c.content).join(""), // chunks are an exact partition of the synced text
        chunks: r.chunks.map((c) => ({ index: c.chunk_index, section: c.heading })),
        total_chunks: r.total_chunks,
        truncated: r.truncated,
        next_chunk: r.next_chunk,
        note: r.truncated ? "นี่เป็นเพียงบางส่วนของโน้ต อย่าอ้างว่าเป็นทั้งโน้ต" : "ครบทั้งโน้ตตามที่ซิงก์ (ส่วนภาพไม่ได้ซิงก์)",
      };
    },
  }),
  define({
    name: "read_obsidian_pdf",
    title: "อ่านข้อความ PDF",
    description: `อ่านข้อความที่ดึงจาก PDF ที่ซิงก์แล้ว (ไม่ใช่ไฟล์ PDF ต้นฉบับ และไม่มี OCR: PDF ที่เป็นภาพสแกนจะไม่มีข้อความ). เลือกช่วงหน้า (page_from/page_to) หรือช่วง chunk ได้ ผลถูกจำกัดขนาด ถ้าถูกตัดจะมี next_chunk. อ้างหน้าที่ได้จากผลลัพธ์เสมอ. ${COVERAGE_NOTE}`,
    schema: z.object({
      id: docId,
      page_from: z.number().int().min(1).optional(),
      page_to: z.number().int().min(1).optional(),
      from_chunk: z.number().int().min(0).optional(),
      to_chunk: z.number().int().min(0).optional(),
      max_chars: z.number().int().min(500).max(40000).optional(),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ id, page_from, page_to, from_chunk, to_chunk, max_chars }) => {
      const r = await readDocument(id, { page_from, page_to, from_chunk, to_chunk, max_chars });
      if (!r) throw new repo.InputError("ไม่พบ PDF นี้ในที่ซิงก์ (อาจไม่ได้แชร์ ถูกลบ ถูกถอนสิทธิ์ หรือไม่มีข้อความให้ดึง)");
      if (r.document.kind !== "pdf") throw new repo.InputError("นี่คือโน้ต ใช้ read_obsidian_note แทน");
      const vault = await pairedVaultName();
      return {
        document_id: r.document.id,
        title: r.document.title,
        type: "pdf",
        source_path: r.document.path,
        obsidian_link: obsidianLink(vault, r.document.path),
        updated_at: r.document.updated_at,
        pages: r.chunks.map((c) => ({ page: c.page, chunk_index: c.chunk_index, text: c.content })),
        total_chunks: r.total_chunks,
        truncated: r.truncated,
        next_chunk: r.next_chunk,
        note: r.truncated ? "นี่เป็นเพียงบางส่วนของ PDF อย่าอ้างว่าอ่านครบทั้งไฟล์" : "ข้อความที่ดึงได้ตามช่วงที่ขอ (เนื้อหาที่เป็นภาพใน PDF ไม่ถูกอ่าน)",
      };
    },
  }),
  define({
    name: "obsidian_status",
    title: "สถานะการเชื่อม Obsidian",
    description: "ดูว่า Mac เชื่อมอยู่ไหม ซิงก์ล่าสุดเมื่อไหร่ มีโน้ต/PDF ที่ซิงก์กี่รายการ มีกี่รายการที่ถูกกันไว้ และมีคำสั่งรอ Mac อยู่กี่รายการ (เป็นตัวเลขเท่านั้น ไม่มีชื่อโน้ตที่ไม่ได้แชร์). ใช้บอกขอบเขตของสิ่งที่ค้นได้",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    run: async () => {
      const s = await getObsidianStatus();
      const n = (status: string, kind?: string) => s.documents.filter((d) => d.status === status && (!kind || d.kind === kind)).reduce((a, d) => a + d.n, 0);
      const sync = s.sync as { device_id: string; status: string; last_success_at: string | null; last_error: string | null; details: string }[];
      return {
        search_available: s.search_ready,
        works_when_mac_is_offline: "ค้นและอ่านสิ่งที่ซิงก์แล้วได้เสมอ ส่วนการแก้ไขต้องรอ Mac ออนไลน์",
        devices: (s.devices as { id: string; name: string; status: string; paused: boolean; last_seen_at: string | null; vault_name: string | null }[]).map((d) => {
          const st = sync.find((x) => x.device_id === d.id);
          let details: Record<string, unknown> = {};
          try {
            details = JSON.parse(st?.details ?? "{}") as Record<string, unknown>;
          } catch {}
          return { name: d.name, vault: d.vault_name, status: d.status, paused: d.paused, last_seen_at: d.last_seen_at, sync_status: st?.status ?? null, last_successful_sync: st?.last_success_at ?? null, last_error: st?.last_error ?? null, last_backup: { local: details.backup_local ?? null, external: details.backup_external ?? null } };
        }),
        synced: { notes: n("synced", "note"), pdfs: n("synced", "pdf") + n("no_text", "pdf") },
        held_back: { by_secret_scan: n("blocked_secret"), revoked: n("blocked_revoked"), failed: n("failed"), conflicts: n("conflict") },
        pdf_text: Object.fromEntries(s.pdf_states.map((p) => [p.state, p.n])),
        open_secret_findings: s.open_findings,
        waiting_for_approval: s.commands.find((c) => c.status === "awaiting_approval")?.n ?? 0,
        approved_waiting_for_mac: (s.commands.find((c) => c.status === "approved")?.n ?? 0) + (s.commands.find((c) => c.status === "claimed")?.n ?? 0),
        approvals_configured: s.approvals_configured,
      };
    },
  }),

  propose(
    "create_note",
    "เสนอสร้างโน้ตใหม่ใน Obsidian",
    "เสนอสร้างโน้ต Markdown ใหม่ที่ path ที่ระบุ (ต้องลงท้าย .md และไม่ซ้ำกับของเดิม ระบบจะไม่เขียนทับและไม่ตั้งชื่อเลขให้) เนื้อหาเต็มจะแสดงให้เจ้าของดูก่อนอนุมัติ โน้ตที่สร้างจะแชร์ (lifeos_sync: true) อัตโนมัติถ้าผ่านการสแกน secret",
    { path, content: z.string().max(900_000).describe("เนื้อหา Markdown เต็ม (ไม่ต้องใส่ frontmatter id/lifeos_sync ระบบเติมให้)") },
    async (a) => {
      await mustNotExist(a.path!);
      return { payload: { path: a.path, content: a.content }, summary: `Create note ${note(a.path!)} (${[...(a.content ?? "")].length} characters)` };
    },
  ),
  propose(
    "edit_note",
    "เสนอแก้โน้ตใน Obsidian",
    "เสนอแทนที่เนื้อหา (body) ของโน้ตที่ซิงก์แล้ว ต้องส่ง content_hash ที่ได้ตอนอ่านโน้ตนั้น ถ้าโน้ตถูกแก้หลังจากนั้น (แม้ตอน Mac ออฟไลน์) ระบบจะหยุดและไม่ทับ ต้องอ่านใหม่แล้วเสนอใหม่. frontmatter (id, lifeos_sync) ระบบเก็บไว้ให้",
    { path, new_content: z.string().max(900_000).describe("เนื้อหาใหม่ทั้งหมดของโน้ต (ไม่รวม frontmatter)"), expected_hash: hash },
    async (a) => {
      const d = await mustBeShared(a.path!);
      if (d.content_hash !== a.expected_hash) throw new repo.InputError("โน้ตนี้เปลี่ยนไปแล้วตั้งแต่ที่อ่าน ให้อ่านด้วย read_obsidian_note อีกครั้งแล้วเสนอใหม่");
      return { payload: { path: d.path, new_content: a.new_content, expected_hash: a.expected_hash }, summary: `Edit note ${note(d.path)}: replace the text (${[...(a.new_content ?? "")].length} characters)` };
    },
  ),
  propose(
    "rename_note",
    "เสนอเปลี่ยนชื่อโน้ต",
    "เสนอเปลี่ยนชื่อโน้ตที่ซิงก์แล้ว (อยู่โฟลเดอร์เดิม) ถ้าชื่อใหม่ซ้ำกับของเดิมจะถูกปฏิเสธ ลิงก์ในโน้ตอื่นไม่ถูกแก้อัตโนมัติ",
    { path, new_path: path, expected_hash: hash.optional() },
    async (a) => {
      const d = await mustBeShared(a.path!);
      if (!sameParent(d.path, a.new_path!)) throw new repo.InputError("เปลี่ยนชื่อต้องอยู่โฟลเดอร์เดิม ถ้าจะย้ายใช้ propose_move_note");
      await mustNotExist(a.new_path!);
      return { payload: { path: d.path, new_path: a.new_path, ...(a.expected_hash ? { expected_hash: a.expected_hash } : {}) }, summary: `Rename note ${note(d.path)} to ${note(nameOf(a.new_path!))}` };
    },
  ),
  propose(
    "move_note",
    "เสนอย้ายโน้ตไปโฟลเดอร์อื่น",
    "เสนอย้ายโน้ตที่ซิงก์แล้วไปโฟลเดอร์อื่น (ชื่อไฟล์เดิม) ถ้ามีไฟล์ชื่อเดียวกันที่ปลายทางจะถูกปฏิเสธ ลิงก์ในโน้ตอื่นไม่ถูกแก้อัตโนมัติ",
    { path, new_path: path, expected_hash: hash.optional() },
    async (a) => {
      const d = await mustBeShared(a.path!);
      if (!sameName(d.path, a.new_path!)) throw new repo.InputError("ย้ายต้องใช้ชื่อไฟล์เดิม ถ้าจะเปลี่ยนชื่อใช้ propose_rename_note");
      if (sameParent(d.path, a.new_path!)) throw new repo.InputError("ปลายทางคือโฟลเดอร์เดิม");
      await mustNotExist(a.new_path!);
      return { payload: { path: d.path, new_path: a.new_path, ...(a.expected_hash ? { expected_hash: a.expected_hash } : {}) }, summary: `Move note ${note(d.path)} to folder ${note(parentOf(a.new_path!) || "(vault root)")}` };
    },
  ),
  propose(
    "delete_note",
    "เสนอลบโน้ต",
    "เสนอลบโน้ตที่ซิงก์แล้ว (ย้ายเข้า .trash ของ Obsidian ไม่ลบถาวร) คำขอนี้หมดอายุเร็ว (24 ชั่วโมง)",
    { path, expected_hash: hash.optional() },
    async (a) => {
      const d = await mustBeShared(a.path!);
      return { payload: { path: d.path, ...(a.expected_hash ? { expected_hash: a.expected_hash } : {}) }, summary: `Delete note ${note(d.path)} (moved to the Obsidian trash)` };
    },
  ),
  propose("create_folder", "เสนอสร้างโฟลเดอร์", "เสนอสร้างโฟลเดอร์ใหม่ใน vault (ปฏิเสธถ้ามีอยู่แล้ว)", { path: folder }, async (a) => {
    if ((await sharedDocsUnder(a.path!, 1)).length || (await sharedDocByPath(a.path!))) throw new repo.InputError("มีโฟลเดอร์หรือไฟล์ชื่อนี้อยู่แล้ว");
    return { payload: { path: a.path }, summary: `Create folder ${note(a.path!)}` };
  }),
  propose(
    "rename_folder",
    "เสนอเปลี่ยนชื่อโฟลเดอร์",
    "เสนอเปลี่ยนชื่อโฟลเดอร์ที่มีโน้ตซิงก์อยู่ (อยู่ที่เดิม) เนื้อหาข้างในทั้งหมดรวมไฟล์ที่ไม่ได้แชร์ย้ายตามไปครบ",
    { path: folder, new_path: folder },
    async (a) => {
      const docs = await mustHaveShared(a.path!);
      if (!sameParent(a.path!, a.new_path!)) throw new repo.InputError("เปลี่ยนชื่อต้องอยู่ที่เดิม ถ้าจะย้ายใช้ propose_move_folder");
      if ((await sharedDocsUnder(a.new_path!, 1)).length) throw new repo.InputError("มีโฟลเดอร์ชื่อนี้อยู่แล้ว");
      const i = await folderImpact(docs);
      return { payload: { path: a.path, new_path: a.new_path, impact: i }, summary: `Rename folder ${note(a.path!)} to ${note(nameOf(a.new_path!))} (${i.synced_notes} synced notes; local-only files move with it)` };
    },
  ),
  propose(
    "move_folder",
    "เสนอย้ายโฟลเดอร์",
    "เสนอย้ายโฟลเดอร์ที่มีโน้ตซิงก์อยู่ไปอยู่ใต้ที่อื่น (ชื่อเดิม) เนื้อหาทั้งหมดรวมไฟล์ที่ไม่ได้แชร์ย้ายตามไป ปฏิเสธถ้าปลายทางมีอยู่แล้ว",
    { path: folder, new_path: folder },
    async (a) => {
      const docs = await mustHaveShared(a.path!);
      if (!sameName(a.path!, a.new_path!)) throw new repo.InputError("ย้ายต้องใช้ชื่อโฟลเดอร์เดิม ถ้าจะเปลี่ยนชื่อใช้ propose_rename_folder");
      if (sameParent(a.path!, a.new_path!)) throw new repo.InputError("ปลายทางคือที่เดิม");
      if (a.new_path!.toLowerCase().startsWith(`${a.path!.toLowerCase()}/`)) throw new repo.InputError("ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้");
      if ((await sharedDocsUnder(a.new_path!, 1)).length) throw new repo.InputError("มีโฟลเดอร์ชื่อนี้อยู่แล้วที่ปลายทาง");
      const i = await folderImpact(docs);
      return { payload: { path: a.path, new_path: a.new_path, impact: i }, summary: `Move folder ${note(a.path!)} to ${note(parentOf(a.new_path!) || "(vault root)")} (${i.synced_notes} synced notes; local-only files move with it)` };
    },
  ),
  propose(
    "delete_folder",
    "เสนอลบโฟลเดอร์",
    "เสนอลบโฟลเดอร์ทั้งโฟลเดอร์ (ย้ายเข้า .trash ของ Obsidian ไม่ลบถาวร) รวมไฟล์ที่ไม่ได้แชร์ข้างในด้วย เจ้าของจะเห็นรายการโน้ตที่ซิงก์ที่ได้รับผลกระทบ จำนวนไฟล์ที่ไม่ได้แชร์ Claude ไม่เห็น คำขอนี้หมดอายุเร็ว (24 ชั่วโมง)",
    { path: folder },
    async (a) => {
      const docs = await mustHaveShared(a.path!);
      const i = await folderImpact(docs);
      return {
        payload: { path: a.path, impact: i },
        summary: `Delete folder ${note(a.path!)}: ${i.synced_notes} synced notes and ${i.synced_pdfs} PDFs are affected. Everything else inside it, including files that are not shared, also goes to the Obsidian trash (your Mac counts those when it applies this)`,
      };
    },
  ),
];
