// Inspect a desktop artifact's bundled better-sqlite3 native module: report its
// CPU arch (static, via detectNativeArch) and the recorded build target, and
// flag a mismatch — the root-cause class behind the desktop "/admin/ 404"
// (sidecar's better_sqlite3.node is wrong-arch / wrong-ABI / unsigned, so
// openDb throws and admin is force-disabled).
//
// Usage:
//   node scripts/verify-release-native.mjs [path]
//     path = an extracted .app dir, a win-unpacked dir, a sidecar dir, or the
//            better_sqlite3.node file itself. Defaults to the locally-built
//            sidecar at package/desktop/resources/sidecar.
//
// What it CAN check here (any OS): CPU arch from the Mach-O/PE/ELF header, and
// the SIDECAR_INFO.json the build stamped (platform/arch/electronVersion).
// What needs the TARGET machine (printed as next-step commands): the ABI load
// test under the bundled Electron, plus macOS codesign/spctl/xattr checks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { detectNativeArch } from "./detectNativeArch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const NODE_NAME = "better_sqlite3.node";

const arg = process.argv[2];
const startPath = arg ? resolve(arg) : resolve(root, "package/desktop/resources/sidecar");

function findUnder(dir, name, depth = 7) {
  if (depth < 0 || !existsSync(dir)) return null;
  let st;
  try {
    st = statSync(dir);
  } catch {
    return null;
  }
  if (st.isFile()) return basename(dir) === name ? dir : null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.name === name) return full;
    if (e.isDirectory()) {
      const hit = findUnder(full, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!existsSync(startPath)) fail(`path not found: ${startPath}`);

const nodeFile = findUnder(startPath, NODE_NAME);
if (!nodeFile) fail(`${NODE_NAME} not found under ${startPath}`);

const buf = readFileSync(nodeFile);
const arch = detectNativeArch(buf);
const magic = buf.length >= 4 ? buf.readUInt32LE(0).toString(16).padStart(8, "0") : "????";
const isFatMachO = buf.length >= 4 && (buf.readUInt32BE(0) === 0xcafebabe || buf.readUInt32BE(0) === 0xbebafece);

console.log("── better-sqlite3 native module ──────────────────────────────");
console.log(`file:           ${nodeFile}`);
console.log(`size:           ${buf.length} bytes`);
console.log(`header magic:   0x${magic}${isFatMachO ? "  (Mach-O universal/fat)" : ""}`);
console.log(`detected arch:  ${arch}`);

// Recorded build target (build-sidecar.mjs stamps this next to the bundle).
const infoFile = findUnder(startPath, "SIDECAR_INFO.json");
let recorded = null;
if (infoFile) {
  try {
    recorded = JSON.parse(readFileSync(infoFile, "utf8"));
    console.log("── SIDECAR_INFO.json ─────────────────────────────────────────");
    console.log(`runtime:        ${recorded.runtime}`);
    console.log(`electron:       ${recorded.electronVersion}`);
    console.log(`built target:   ${recorded.platform}-${recorded.arch}`);
    console.log(`built at:       ${recorded.builtAt}`);
  } catch {
    console.log("SIDECAR_INFO.json present but unparseable.");
  }
} else {
  console.log("SIDECAR_INFO.json not found (older build or partial extract).");
}

let bad = false;
if (arch === "unknown") {
  console.log(`\n⚠ Could not determine CPU arch from the header (magic 0x${magic}).`);
  bad = true;
} else if (recorded && recorded.arch && recorded.arch !== arch) {
  console.log(`\n✗ ARCH MISMATCH — module is ${arch} but the bundle was built for ${recorded.arch}.`);
  console.log(`  This is the wrong-arch failure (e.g. arm64 module inside an x64 package).`);
  bad = true;
} else {
  console.log(`\n✓ CPU arch looks consistent (${arch}).`);
}

// ABI + signing need the target machine — print the exact commands.
const plat = recorded?.platform ?? "darwin/win32";
console.log("\n── next checks (run on the TARGET machine) ───────────────────");
if (plat === "darwin") {
  const appGuess = nodeFile.split("/Contents/Resources/")[0];
  const sidecarDir = dirname(dirname(dirname(nodeFile))); // .../better-sqlite3
  console.log("ABI / load (Apple Silicon AMFI also enforced here):");
  console.log(`  ELECTRON_RUN_AS_NODE=1 "${appGuess}/Contents/MacOS/mimo2codex" \\`);
  console.log(`    -e "const D=require('${sidecarDir}'); new D(':memory:').close(); console.log('LOAD OK', process.versions.modules)"`);
  console.log("signing / quarantine:");
  console.log(`  codesign -dv --verbose=4 "${nodeFile}"`);
  console.log(`  spctl -a -vv "${appGuess}"`);
  console.log(`  xattr -lr "${nodeFile}"`);
} else {
  console.log("ABI / load:");
  console.log(`  set ELECTRON_RUN_AS_NODE=1 & "<app>\\mimo2codex.exe" -e "const D=require('<...>\\better-sqlite3'); new D(':memory:').close(); console.log('LOAD OK', process.versions.modules)"`);
}
console.log("\nInterpreting the load error:");
console.log("  'incompatible architecture'      → wrong arch   (see ARCH MISMATCH above)");
console.log("  'NODE_MODULE_VERSION N requires M'→ wrong ABI    (electron/abi drift)");
console.log("  'code signature' / 'killed: 9'   → signing/AMFI  (extraResources .node unsigned)");
console.log("  loads OK but admin still off     → dataDir/path/permission");

process.exit(bad ? 1 : 0);
