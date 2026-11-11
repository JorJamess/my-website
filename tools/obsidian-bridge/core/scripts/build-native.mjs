// Builds the PDF text helper with the Swift compiler that ships with the Command Line Tools (no Xcode needed).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const native = join(here, "../native");
const bin = join(native, "bin");
mkdirSync(bin, { recursive: true });
if (process.platform !== "darwin") {
  console.log("skipping native helper: macOS only");
  process.exit(0);
}
const targets = process.argv.includes("--with-fixture-tool") ? ["pdf-text", "make-fixture"] : ["pdf-text"];
for (const name of targets) {
  execFileSync("swiftc", ["-O", join(native, `${name}.swift`), "-o", join(bin, name)], { stdio: "inherit" });
  console.log(`built native/bin/${name}`);
}
