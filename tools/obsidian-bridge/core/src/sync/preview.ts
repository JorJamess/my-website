import { scanForSecrets } from "../shared/secrets.js";
import { scanVault } from "../vault/scan.js";

export type InitialPreview = {
  markdownFiles: number;
  eligibleNotes: number;
  notesWithId: number;
  notesNeedingId: number;
  invalidIds: number;
  duplicateIdGroups: number;
  referencedPdfs: number;
  pdfsTooLarge: number;
  pdfsNotFound: number;
  blockedBySecretScan: number;
  estimatedTextBytes: number;
  unreadable: number;
  ambiguousFlags: number;
};

/**
 * What the first sync would send, in numbers only. Local-only notes are counted but never named,
 * and nothing is uploaded or changed by looking at this.
 */
export async function previewInitialSync(vaultPath: string, opts: { pdfMaxBytes?: number } = {}): Promise<InitialPreview> {
  const scan = await scanVault(vaultPath, opts);
  const pdfs = new Map<string, "ok" | "too_large" | "missing">();
  let blocked = 0;
  let bytes = 0;
  let withId = 0;
  let invalid = 0;
  for (const n of scan.notes) {
    if (n.idValid) withId++;
    else if (n.id) invalid++;
    bytes += Buffer.byteLength(n.rendered);
    if (scanForSecrets(`${n.title}\n${n.rendered}`).length) blocked++;
    for (const p of n.pdfs) pdfs.set(p.rel ?? `x:${p.target}`, p.status === "ok" ? "ok" : p.status === "too_large" ? "too_large" : "missing");
  }
  const vals = [...pdfs.values()];
  return {
    markdownFiles: scan.counts.markdown,
    eligibleNotes: scan.counts.shared,
    notesWithId: withId,
    notesNeedingId: scan.notes.filter((n) => !n.id).length,
    invalidIds: invalid,
    duplicateIdGroups: scan.duplicates.size,
    referencedPdfs: vals.filter((v) => v !== "missing").length,
    pdfsTooLarge: vals.filter((v) => v === "too_large").length,
    pdfsNotFound: vals.filter((v) => v === "missing").length,
    blockedBySecretScan: blocked,
    estimatedTextBytes: bytes,
    unreadable: scan.counts.unreadable,
    ambiguousFlags: scan.ambiguousFlag,
  };
}
