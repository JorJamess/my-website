import { z } from "zod";
import { MAX_CHUNKS_PER_REQUEST } from "@/lib/obsidian/chunk";

const docId = z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/, "Invalid document id");
const iso = z.string().max(40);

export const pairCompleteSchema = z.object({
  code: z.string().min(6).max(20),
  name: z.string().min(1).max(80),
  vault_name: z.string().max(120).optional(),
  version: z.string().max(40).optional(),
});

const finding = z.object({ kind: z.string().max(40), line: z.number().int().min(0), redacted: z.string().max(12), fingerprint: z.string().max(80) });

export const uploadSchema = z.object({
  id: docId,
  kind: z.enum(["note", "pdf"]),
  title: z.string().min(1).max(300),
  path: z.string().min(1).max(400),
  content_hash: z.string().min(8).max(128),
  tags: z.array(z.string().max(60)).max(50).default([]),
  source_updated_at: iso.nullish(),
  grant_version: z.number().int().min(0),
  sync_version: z.number().int().min(1),
  total_chunks: z.number().int().min(0).max(5000),
  part: z.number().int().min(0).default(0),
  chunks: z
    .array(z.object({ index: z.number().int().min(0), page: z.number().int().min(1).nullish(), heading: z.string().max(200).nullish(), content: z.string().min(1).max(8000) }))
    .max(MAX_CHUNKS_PER_REQUEST),
  pdf_refs: z.array(docId).max(200).optional(),
  pdf: z.object({ state: z.enum(["pending", "processing", "completed", "no_text", "failed", "too_large"]), size_bytes: z.number().int().nullish(), pages: z.number().int().nullish(), message: z.string().max(200).nullish() }).optional(),
});

export const blockedSchema = z.object({ id: docId, title: z.string().min(1).max(300), path: z.string().min(1).max(400), content_hash: z.string().min(8).max(128), kind: z.enum(["note", "pdf"]).optional(), findings: z.array(finding).max(50) });
export const pathSchema = z.object({ path: z.string().min(1).max(400), title: z.string().max(300).optional() });
export const resultSchema = z.object({ status: z.enum(["applied", "conflict", "failed"]), message: z.string().max(200).optional(), conflict: z.record(z.string(), z.unknown()).optional() });
export const heartbeatSchema = z.object({
  status: z.enum(["idle", "syncing", "paused", "error"]),
  error: z.string().max(200).optional(),
  success: z.boolean().optional(),
  sync_request_seen: z.boolean().optional(),
  details: z.record(z.string(), z.union([z.string().max(120), z.number(), z.boolean(), z.null()])).optional(),
});
export const deviceActionSchema = z.object({ action: z.enum(["revoke", "pause", "resume", "sync"]) });
export const revokeSchema = z.object({ reason: z.string().max(80).optional() });
