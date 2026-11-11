import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PDF_MAX_BYTES } from "../vault/scan.js";

export type PdfPage = { page: number; text: string };
export type PdfResult =
  | { state: "completed"; pages: number; sizeBytes: number; content: PdfPage[] }
  | { state: "no_text" | "failed" | "too_large"; pages: number; sizeBytes: number; message: string; content: [] };

export type PdfExtractor = (absPath: string) => Promise<PdfResult>;

const MAX_TOTAL_CHARS = 20_000_000;

/** Run the native helper on one PDF. Refuses files over the size limit before reading anything. */
export function createPdfExtractor(helperPath: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): PdfExtractor {
  const maxBytes = opts.maxBytes ?? PDF_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  return async (abs) => {
    const s = await stat(abs).catch(() => null);
    if (!s || !s.isFile()) return { state: "failed", pages: 0, sizeBytes: 0, message: "File not found", content: [] };
    if (s.size > maxBytes) return { state: "too_large", pages: 0, sizeBytes: s.size, message: `Larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, content: [] };
    return new Promise<PdfResult>((resolve) => {
      const child = spawn(helperPath, [abs], { stdio: ["ignore", "pipe", "pipe"] });
      const pages: PdfPage[] = [];
      let info: { pages: number; locked: boolean } | null = null;
      let error: string | null = null;
      let total = 0;
      let overflow = false;
      const timer = setTimeout(() => {
        error = "Timed out reading the PDF";
        child.kill("SIGKILL");
      }, timeoutMs);
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        try {
          const o = JSON.parse(line) as { type: string; pages?: number; locked?: boolean; page?: number; text?: string; message?: string };
          if (o.type === "info") info = { pages: o.pages ?? 0, locked: !!o.locked };
          else if (o.type === "error") error = o.message ?? "Unreadable PDF";
          else if (o.type === "page" && typeof o.page === "number") {
            const text = (o.text ?? "").normalize("NFC").replace(/\r\n?/g, "\n").trim();
            total += text.length;
            if (total > MAX_TOTAL_CHARS) {
              overflow = true;
              child.kill("SIGKILL");
            } else if (text) pages.push({ page: o.page, text });
          }
        } catch {
          /* ignore malformed lines */
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ state: "failed", pages: 0, sizeBytes: s.size, message: "PDF reader is not installed (run the build)", content: [] });
      });
      child.on("close", () => {
        clearTimeout(timer);
        const n = (info as { pages: number } | null)?.pages ?? 0;
        if (overflow) return resolve({ state: "failed", pages: n, sizeBytes: s.size, message: "The PDF has too much text to sync", content: [] });
        if (error || !info) return resolve({ state: "failed", pages: n, sizeBytes: s.size, message: error ?? "Could not read the PDF", content: [] });
        if ((info as { locked: boolean }).locked) return resolve({ state: "failed", pages: n, sizeBytes: s.size, message: "The PDF is password protected", content: [] });
        if (!pages.length) return resolve({ state: "no_text", pages: n, sizeBytes: s.size, message: "No selectable text (scanned or image-only). OCR is not part of this version.", content: [] });
        resolve({ state: "completed", pages: n, sizeBytes: s.size, content: pages });
      });
    });
  };
}

/** Turn pages into bounded chunks that keep their page number. Long pages are split. */
export function pdfChunks(pages: PdfPage[], max = 4000) {
  const out: { page: number; heading: null; content: string }[] = [];
  for (const p of pages) {
    for (let i = 0; i < p.text.length; i += max) out.push({ page: p.page, heading: null, content: p.text.slice(i, i + max) });
  }
  return out;
}
