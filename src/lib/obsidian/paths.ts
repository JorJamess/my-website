// Vault path rules shared by the Worker (proposal validation) and the Mac Bridge (before touching a file).
// Paths are always relative to the vault root, with "/" separators.

export class PathError extends Error {}

const MAX_PATH = 400;
const MAX_SEGMENT = 150;
// characters that macOS/Obsidian do not accept or that confuse links
const BAD_CHARS = /[\u0000-\u001f\\:*?"<>|#^[\]]/;

/** Validate a vault-relative path. Returns it normalised (NFC, no trailing slash). Throws PathError. */
export function validateVaultPath(input: string, opts: { kind: "note" | "folder" | "pdf" }): string {
  if (typeof input !== "string" || !input.trim()) throw new PathError("Path is empty");
  const p = input.normalize("NFC");
  if (p.length > MAX_PATH) throw new PathError("Path is too long");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("~")) throw new PathError("Path must be inside the vault (relative)");
  const segments = p.replace(/\/+$/, "").split("/");
  for (const s of segments) {
    if (!s) throw new PathError("Path has an empty folder name");
    if (s === "." || s === "..") throw new PathError("Path can't contain . or ..");
    if (s.length > MAX_SEGMENT) throw new PathError("A name in the path is too long");
    if (BAD_CHARS.test(s)) throw new PathError(`The name "${s}" has characters that aren't allowed`);
    if (s !== s.trim() || s.endsWith(".")) throw new PathError(`The name "${s}" can't start or end with a space or end with a dot`);
  }
  // .obsidian (settings), .trash and every other hidden name are off limits
  if (segments.some((s) => s.startsWith("."))) throw new PathError("Hidden folders, the .obsidian settings folder and the trash can't be used");
  if (opts.kind === "note" && !/\.md$/i.test(segments[segments.length - 1])) throw new PathError("A note path must end with .md");
  if (opts.kind === "pdf" && !/\.pdf$/i.test(segments[segments.length - 1])) throw new PathError("A PDF path must end with .pdf");
  return segments.join("/");
}

/** True if `child` is the same as or inside `folder` (both validated, vault-relative). */
export const isInside = (child: string, folder: string) => child === folder || child.startsWith(`${folder}/`);
