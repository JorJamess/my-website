// The Worker and the Bridge must agree exactly on secret fingerprints, path rules and chunking.
// The shared files live in the website's src/lib/obsidian; this copies them into the Bridge so the package stays independent.
// A test in the website repo fails if the copies drift.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "../../../../src/lib/obsidian");
const to = join(here, "../src/shared");
mkdirSync(to, { recursive: true });
for (const f of ["secrets.ts", "paths.ts", "chunk.ts", "crypto.ts", "diff.ts"]) copyFileSync(join(from, f), join(to, f));
console.log("shared files copied");
