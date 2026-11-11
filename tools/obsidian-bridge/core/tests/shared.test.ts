import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Worker and the Bridge must use exactly the same secret rules, path rules and chunk sizes.
describe("shared files", () => {
  for (const f of ["secrets.ts", "paths.ts", "chunk.ts", "crypto.ts", "diff.ts"]) {
    it(`${f} matches the website copy`, () => {
      const site = readFileSync(join(__dirname, "../../../../src/lib/obsidian", f), "utf8");
      const bridge = readFileSync(join(__dirname, "../src/shared", f), "utf8");
      expect(bridge, `run: npm run sync-shared (in tools/obsidian-bridge/core)`).toBe(site);
    });
  }
});
