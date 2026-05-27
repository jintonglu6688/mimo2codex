// Verifies that better-sqlite3 has a precompiled native binary for the
// requested platform/arch. Exits 0 if available, 1 if missing.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const platform = process.env.TARGET_PLATFORM ?? process.platform;
const arch = process.env.TARGET_ARCH ?? process.arch;

// Resolve installed better-sqlite3 root
const pkgRoot = join(__dirname, "..", "node_modules", "better-sqlite3");
if (!existsSync(pkgRoot)) {
  console.error("better-sqlite3 not installed; run `npm ci` first.");
  process.exit(1);
}

// Look for a prebuilt .node matching this platform+arch.
// Layout: better-sqlite3/build/Release/better_sqlite3.node (after install)
// OR: better-sqlite3/prebuilds/<platform>-<arch>/node.napi.node (raw download)
const candidates = [
  join(pkgRoot, "build", "Release", "better_sqlite3.node"),
  join(pkgRoot, "prebuilds", `${platform}-${arch}`, "node.napi.node"),
  join(pkgRoot, "prebuilds", `${platform}-${arch}`, "better-sqlite3.node"),
];
const found = candidates.find(existsSync);
if (!found) {
  console.error(`No better-sqlite3 prebuild found for ${platform}-${arch}.`);
  console.error("Candidates checked:");
  for (const c of candidates) console.error("  -", c);
  process.exit(1);
}
console.log(`OK: better-sqlite3 prebuild present for ${platform}-${arch} at ${found}`);
