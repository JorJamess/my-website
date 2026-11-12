import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** true when `child` is the same folder as `parent` or inside it (a folder literally named "..x" counts as inside) */
export const insideOrSame = (child: string, parent: string) => {
  const rel = relative(resolve(parent), resolve(child));
  return !rel || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
};

/** The real location of a path, following symlinks; a folder that does not exist yet is resolved through its nearest existing parent. */
export async function realish(p: string): Promise<string> {
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(await realish(parent), basename(abs));
  }
}
