// Build a self-contained sidecar bundle for the current platform.
// Output: package/desktop/resources/sidecar/{dist,node_modules,package.json,SIDECAR_INFO.json}
//
// Strategy: ship the compiled dist/ + production node_modules. NO separate
// Node binary — at runtime, the desktop app spawns its own Electron binary
// with ELECTRON_RUN_AS_NODE=1, which runs the sidecar in Electron's bundled
// Node context. This means better-sqlite3's `electron-vXY` prebuild lines up
// perfectly with the host Node ABI at runtime, with no ABI mismatch risk.
//
// Why this matters: better-sqlite3@12.x publishes prebuilds primarily for
// Electron ABIs. Targeting a plain Node version often misses (especially on
// win32-x64), forcing source compilation that requires Visual Studio C++.
import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectNativeArch } from "./detectNativeArch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sidecarOut = resolve(root, "package/desktop/resources/sidecar");
const desktopDir = resolve(root, "package/desktop");

// Read installed Electron version — that's the ABI our sidecar must target.
const electronPkgJson = resolve(desktopDir, "node_modules/electron/package.json");
if (!existsSync(electronPkgJson)) {
  console.error("Electron not installed under package/desktop/node_modules.");
  console.error("Run: npm --prefix package/desktop install");
  process.exit(1);
}
const ELECTRON_VERSION = JSON.parse(readFileSync(electronPkgJson, "utf8")).version;
const arch = process.env.SIDECAR_ARCH || process.arch;
const platform = process.env.SIDECAR_PLATFORM || process.platform;
// Normalized build targets, shared by the install step and the arch check below.
const targetArch = arch === "arm64" ? "arm64" : "x64";
const targetPlatform = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";

function clean() {
  rmSync(sidecarOut, { recursive: true, force: true });
  mkdirSync(sidecarOut, { recursive: true });
}

function buildCli() {
  console.log("[sidecar] building CLI (tsc + web admin UI)...");
  // build:all = tsc compile + web admin UI (React bundle in dist/web/).
  // Without web:build, the packaged sidecar shows "Admin UI not built" on
  // first /admin/ request — the mimo2codex CLI expects dist/web/ to exist.
  execSync("npm run build:all", { cwd: root, stdio: "inherit" });
}

function copyCliArtifacts() {
  console.log("[sidecar] copying dist/ and package.json, then installing prod deps...");
  cpSync(resolve(root, "dist"), resolve(sidecarOut, "dist"), { recursive: true });
  // mimoskill is referenced at runtime by the CLI for OCR / image-gen helpers
  if (existsSync(resolve(root, "mimoskill"))) {
    cpSync(resolve(root, "mimoskill"), resolve(sidecarOut, "mimoskill"), { recursive: true });
  }
  cpSync(resolve(root, "package.json"), resolve(sidecarOut, "package.json"));

  // Critical: tell prebuild-install to fetch the **Electron-runtime** prebuild
  // for better-sqlite3, NOT the Node prebuild. At runtime the sidecar is spawned
  // via `electron.exe` with ELECTRON_RUN_AS_NODE=1, so the loaded native module
  // must match Electron's bundled Node ABI — not the host Node we're using to
  // run `npm install`.
  //
  // better-sqlite3@12 publishes electron-vXY prebuilds for all major platforms;
  // node-vXY prebuilds for win32-x64 are unreliable (and missing source-build
  // tooling on most Windows machines), so the electron-runtime path is safer.
  const sidecarEnv = {
    ...process.env,
    npm_config_target: ELECTRON_VERSION,
    npm_config_runtime: "electron",
    npm_config_disturl: "https://electronjs.org/headers",
    // prebuild-install (better-sqlite3's binary fetcher) honors npm_config_arch
    // / npm_config_platform — NOT the npm_config_target_* keys, which only
    // node-gyp reads for source builds. Setting only target_* meant a cross-arch
    // build (arm64 runner → x64 package) silently fell back to process.arch and
    // fetched the wrong-arch prebuild — issue #69. Set both: arch/platform drives
    // the prebuild download, target_* stays as a node-gyp source-build fallback.
    npm_config_arch: targetArch,
    npm_config_platform: targetPlatform,
    npm_config_target_arch: targetArch,
    npm_config_target_platform: targetPlatform,
    npm_config_build_from_source: "false",
  };
  console.log(`[sidecar] installing prod deps targeting electron ${ELECTRON_VERSION} / ${targetPlatform}-${targetArch}...`);
  execSync("npm install --omit=dev --no-audit --no-fund", {
    cwd: sidecarOut,
    env: sidecarEnv,
    stdio: "inherit",
  });
}

function dirSizeMb(p) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    if (e.isDirectory()) total += dirSizeMb(full) * 1024 * 1024;
    else total += statSync(full).size;
  }
  return Math.round(total / (1024 * 1024));
}

function findBetterSqlite3Node() {
  const base = resolve(sidecarOut, "node_modules/better-sqlite3");
  const candidates = [
    join(base, "build", "Release", "better_sqlite3.node"),
    join(base, "prebuilds", `${targetPlatform}-${targetArch}`, "better-sqlite3.node"),
    join(base, "prebuilds", `${targetPlatform}-${targetArch}`, "node.napi.node"),
  ];
  return candidates.find(existsSync) ?? null;
}

// Static arch check — reads the native module's header (Mach-O/PE/ELF) and
// asserts it matches the build target. Unlike the smoke test below, this works
// for cross-arch builds too (we can't *run* a foreign binary, but we can read
// its header), so it catches the issue #69 class of bug in CI instead of
// shipping a wrong-arch module to users.
function verifyNativeArch() {
  const nodeFile = findBetterSqlite3Node();
  if (!nodeFile) {
    throw new Error(
      `[sidecar] better-sqlite3 native module not found under ${sidecarOut}.\n` +
      `The prod-deps install step likely failed to fetch a prebuild.`
    );
  }
  const detected = detectNativeArch(readFileSync(nodeFile));
  if (detected !== targetArch) {
    throw new Error(
      `[sidecar] ARCH MISMATCH — better-sqlite3 native module is "${detected}" but ` +
      `the build target is "${targetArch}".\n` +
      `File: ${nodeFile}\n` +
      `This is the issue #69 bug (e.g. an arm64 module shipped inside the x64 ` +
      `package). Check that npm_config_arch actually reached prebuild-install.`
    );
  }
  console.log(`[sidecar] native arch OK — better-sqlite3 is ${detected} (target ${targetArch})`);
}

function smokeTestWithElectron() {
  // Only safe when building for the same platform/arch we're running on
  if (platform !== process.platform || arch !== process.arch) {
    console.log(`[sidecar] skipping smoke test (cross-target ${platform}-${arch} vs host ${process.platform}-${process.arch})`);
    return;
  }
  const electronBin = platform === "win32"
    ? resolve(desktopDir, "node_modules/electron/dist/electron.exe")
    : platform === "darwin"
    ? resolve(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : resolve(desktopDir, "node_modules/electron/dist/electron");

  if (!existsSync(electronBin)) {
    console.log(`[sidecar] skipping smoke test (electron binary not found at ${electronBin})`);
    return;
  }

  console.log("[sidecar] smoke-testing better-sqlite3 with Electron as Node (ABI check)...");
  try {
    execSync(
      `"${electronBin}" -e "require('better-sqlite3'); console.log('OK')"`,
      {
        cwd: sidecarOut,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "inherit",
      }
    );
  } catch (e) {
    throw new Error(
      `Sidecar smoke test failed — better-sqlite3 won't load under Electron-as-Node.\n` +
      `Likely no electron-vXY prebuild matched electron@${ELECTRON_VERSION} ${platform}-${arch}.\n` +
      `Original error: ${e.message}`
    );
  }
}

async function main() {
  clean();
  buildCli();
  copyCliArtifacts();
  verifyNativeArch();
  smokeTestWithElectron();
  writeFileSync(resolve(sidecarOut, "SIDECAR_INFO.json"), JSON.stringify({
    runtime: "electron",
    electronVersion: ELECTRON_VERSION,
    platform,
    arch,
    builtAt: new Date().toISOString(),
  }, null, 2));
  const sizeMb = dirSizeMb(sidecarOut);
  console.log(`[sidecar] done → ${sidecarOut} (~${sizeMb} MB)`);
}
main().catch((err) => { console.error(err); process.exit(1); });
