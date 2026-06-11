#!/usr/bin/env node
// One-shot local packaging script for the mimo2codex desktop shell.
//
// Usage:
//   npm run desktop:pack:local
//   npm run desktop:pack:local -- --skip-sidecar      # reuse existing sidecar bundle
//   npm run desktop:pack:local -- --force-icons       # force regenerate tray icons
//   npm run desktop:pack:local -- --clean             # rm -rf release/ first
//
// Output: package/desktop/release/mimo2codex-desktop-<version>-<plat>-<arch>.{exe,dmg}
import { spawn, execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, symlinkSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const desktop = resolve(root, "package/desktop");

const argv = process.argv.slice(2);
const targetFlag = argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);
const flags = {
  skipSidecar: argv.includes("--skip-sidecar"),
  forceIcons: argv.includes("--force-icons"),
  clean: argv.includes("--clean"),
  /** Wipe electron-builder's winCodeSign cache (use after a failed extraction). */
  cleanEbCache: argv.includes("--clean-eb-cache"),
};

// win-arm64 is intentionally unsupported — better-sqlite3 v12.x has no reliable
// win32-arm64 prebuild, so the package would bundle a wrong-arch native module
// and 404 on /admin/. Windows-on-ARM runs the x64 build under emulation.
const VALID_TARGETS = ["win-x64", "mac-x64", "mac-arm64"];
if (targetFlag && !VALID_TARGETS.includes(targetFlag)) {
  console.error(`Invalid --target=${targetFlag}. Valid: ${VALID_TARGETS.join(", ")}`);
  process.exit(1);
}

// Defaults to host platform/arch; --target=<plat>-<arch> overrides for cross-build.
const [tPlat, tArch] = targetFlag ? targetFlag.split("-") : [process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux", process.arch];
const platform = tPlat === "win" ? "win32" : tPlat === "mac" ? "darwin" : "linux";
const arch = tArch;
const isCrossBuild = platform !== process.platform || arch !== process.arch;
const platformLabel = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";

// ── Pretty output helpers ─────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};
const SEP = "─".repeat(64);

function banner(title) {
  console.log(`\n${C.cyan}${SEP}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${title}${C.reset}`);
  console.log(`${C.cyan}${SEP}${C.reset}`);
}

function step(n, total, label) {
  console.log(`\n${C.bold}[${n}/${total}]${C.reset} ${label}`);
}

function ok(t0, extra = "") {
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`        ${C.green}✓${C.reset} ${C.dim}done in ${sec}s${extra ? "  " + extra : ""}${C.reset}`);
}

function note(msg) {
  console.log(`        ${C.dim}${msg}${C.reset}`);
}

function fail(msg) {
  console.error(`\n${C.red}✗ ${msg}${C.reset}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.silent ? "pipe" : "inherit",
      shell: process.platform === "win32",
      cwd: opts.cwd ?? root,
      env: opts.env ?? process.env,
    });
    let buf = "";
    if (opts.silent) {
      child.stdout?.on("data", (b) => buf += b);
      child.stderr?.on("data", (b) => buf += b);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(buf);
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 ** 3)).toFixed(2) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 ** 2)).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(1) + " KB";
}

/** Returns true if the current Windows process can create symbolic links. */
function canCreateSymlinkOnWindows() {
  const probe = join(tmpdir(), `m2c-symlink-test-${process.pid}`);
  const src = probe + ".src";
  const link = probe + ".link";
  try {
    writeFileSync(src, "");
    symlinkSync(src, link, "file");
    return true;
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "UNKNOWN")) return false;
    throw err;
  } finally {
    try { unlinkSync(link); } catch { /* ignore */ }
    try { unlinkSync(src); } catch { /* ignore */ }
  }
}

// ── Pre-flight ───────────────────────────────────────────────────────────
banner(`mimo2codex desktop · local pack · ${platformLabel} ${arch}`);

const totalSteps = 7;
let n = 0;

// Step 1: dependency presence + Windows symlink capability
n++;
step(n, totalSteps, "Checking dependencies");
{
  if (!existsSync(join(root, "node_modules"))) {
    fail("root node_modules missing. Run: npm ci");
  }
  if (!existsSync(join(desktop, "node_modules"))) {
    fail("package/desktop/node_modules missing. Run: npm --prefix package/desktop install");
  }
  // Probe better-sqlite3 prebuild for current arch — early-fails if missing
  try {
    execSync("node scripts/probe-prebuild.mjs", { cwd: root, stdio: "pipe" });
  } catch (err) {
    fail(`better-sqlite3 prebuild missing for ${platform}-${arch}.\n        Try: npm rebuild better-sqlite3\n        Detail: ${(err.stdout || err.stderr || "").toString()}`);
  }
  note("root + package/desktop installed; better-sqlite3 prebuild present");

  // Host-Windows specific: electron-builder downloads winCodeSign which contains
  // macOS dylib symlinks. Extracting them requires either Developer Mode or
  // admin privileges; without that, the build fails with cryptic 7zip errors
  // after 4 retry attempts. Detect this BEFORE we spend 5 minutes on sidecar.
  // (Skip when cross-building from a non-Win host targeting Mac, etc.)
  if (process.platform === "win32") {
    if (!canCreateSymlinkOnWindows()) {
      fail(
        "Windows cannot create symbolic links with current privileges.\n" +
        "        electron-builder needs this to extract its winCodeSign cache.\n\n" +
        `        ${C.bold}Fix (pick one):${C.reset}\n` +
        "         1. Enable Windows Developer Mode (recommended, one-time):\n" +
        "              Settings → System → For developers → Developer Mode → On\n" +
        "         2. Run this command from an elevated PowerShell\n" +
        "              (right-click PowerShell → Run as Administrator)\n\n" +
        "        After fixing, also clean any partial cache by rerunning with\n" +
        "        --clean-eb-cache, e.g.:\n" +
        "              npm run desktop:pack:local -- --clean-eb-cache"
      );
    }
    note("Windows symlink permission OK");

    if (flags.cleanEbCache) {
      const ebCache = join(homedir(), "AppData", "Local", "electron-builder", "Cache", "winCodeSign");
      if (existsSync(ebCache)) {
        rmSync(ebCache, { recursive: true, force: true });
        note(`cleaned electron-builder winCodeSign cache: ${ebCache}`);
      } else {
        note("electron-builder winCodeSign cache already absent");
      }
    }
  }
}

// Step 2: brand icons (tray + app icons)
n++;
step(n, totalSteps, "Brand icons (tray + .ico / template PNG)");
{
  const trayIco = join(root, "package/win/tray.ico");
  const appIco = join(root, "package/win/icon.ico");
  const trayPng = join(root, "package/mac/tray-Template.png");
  const allPresent = existsSync(trayIco) && existsSync(appIco) && existsSync(trayPng);
  if (allPresent && !flags.forceIcons) {
    note("skipped (already present; use --force-icons to regenerate)");
  } else {
    const t0 = performance.now();
    await run("npm", ["run", "brand:icons"]);
    ok(t0);
  }
}

// Step 2b: Mac-only — icon.icns
if (platform === "darwin") {
  step("2b", totalSteps, "macOS icon.icns");
  const icns = join(root, "package/mac/icon.icns");
  const logoPng = join(root, "package/brand/logo-1024.png");
  if (existsSync(icns) && !flags.forceIcons) {
    note("skipped (already present)");
  } else {
    if (!existsSync(logoPng)) {
      const t0 = performance.now();
      note("running brand:render to produce logo-1024.png first...");
      await run("npm", ["run", "brand:render"]);
      ok(t0);
    }
    const t0 = performance.now();
    const iconset = join(root, "package/mac/icon.iconset");
    rmSync(iconset, { recursive: true, force: true });
    mkdirSync(iconset, { recursive: true });
    const sizes = [
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024],
    ];
    for (const [name, size] of sizes) {
      execSync(`npx --yes sharp-cli@4 -i package/brand/logo-1024.png -o package/mac/icon.iconset/${name} resize ${size} ${size}`, { cwd: root, stdio: "inherit" });
    }
    execSync(`iconutil -c icns -o package/mac/icon.icns package/mac/icon.iconset`, { cwd: root, stdio: "inherit" });
    rmSync(iconset, { recursive: true, force: true });
    ok(t0);
  }
}

// Step 3: sidecar bundle (CLI + node_modules for Electron-as-Node runtime)
n++;
step(n, totalSteps, `Sidecar bundle (CLI + electron-ABI prebuilds for ${platform}-${arch})`);
{
  const cliEntry = resolve(desktop, "resources/sidecar/dist/cli.js");
  const betterSqlite = resolve(desktop, "resources/sidecar/node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  const present = existsSync(cliEntry) && existsSync(betterSqlite);
  if (flags.skipSidecar) {
    if (!present) fail("--skip-sidecar set but resources/sidecar/ is incomplete. Run without the flag.");
    note("skipped (--skip-sidecar; reusing existing bundle)");
  } else {
    if (present) {
      note("existing bundle will be rebuilt (set --skip-sidecar to reuse)");
    }
    if (isCrossBuild) {
      note(`cross-build: SIDECAR_PLATFORM=${platform} SIDECAR_ARCH=${arch}`);
    }
    const t0 = performance.now();
    // Inject SIDECAR_PLATFORM / SIDECAR_ARCH so the bundler asks prebuild-install
    // for the *target* darwin-arm64 / win32-x64 / etc. prebuilds, not host's.
    await run("npm", ["run", "sidecar:build"], {
      env: { ...process.env, SIDECAR_PLATFORM: platform, SIDECAR_ARCH: arch },
    });
    ok(t0);
  }
}

// Step 4: desktop build (tsc + vite)
n++;
step(n, totalSteps, "Desktop build (main process tsc + renderer vite)");
{
  const t0 = performance.now();
  await run("npm", ["run", "build"], { cwd: desktop });
  ok(t0);
}

// Step 5: clean release dir if requested
if (flags.clean) {
  step("5a", totalSteps, "Cleaning release/ dir");
  const releaseDir = resolve(desktop, "release");
  rmSync(releaseDir, { recursive: true, force: true });
  note(`removed ${releaseDir}`);
}

// Step 6: electron-builder
n++;
step(n, totalSteps, `electron-builder → ${platformLabel} ${arch}${isCrossBuild ? " (cross-build)" : ""}`);
{
  // For cross-builds we call electron-builder directly with explicit target
  // flags. For host-platform builds we use the package's pack:win / pack:mac
  // npm script (semantically identical, kept as user-visible aliases).
  const platFlag = platform === "win32" ? "--win" : platform === "darwin" ? "--mac" : "--linux";
  const archFlag = `--${arch}`;
  const t0 = performance.now();
  try {
    await run(
      "npx",
      ["electron-builder", platFlag, archFlag, "--publish", "never"],
      { cwd: desktop }
    );
    ok(t0);
  } catch (err) {
    if (process.platform === "win32" && platform === "win32") {
      console.error(
        `\n${C.red}✗ electron-builder failed.${C.reset}\n\n` +
        `${C.bold}If the log above contains "Cannot create symbolic link"${C.reset}, your\n` +
        "Windows account lacks permission to create symlinks. Fix it once:\n" +
        "  1. Settings → System → For developers → Developer Mode → On\n" +
        "  2. Re-run: npm run desktop:pack:local -- --skip-sidecar --clean-eb-cache\n\n" +
        "Other common issues:\n" +
        "  • Antivirus quarantining files in package/desktop/release/ — disable temporarily\n" +
        "  • Disk space: each pack writes ~300 MB to ~/AppData/Local/electron-builder/\n"
      );
    } else if (isCrossBuild && platform === "darwin") {
      console.error(
        `\n${C.red}✗ Cross-build mac from ${process.platform} failed.${C.reset}\n\n` +
        "Cross-platform Mac builds from Windows are unreliable for .dmg.\n" +
        `Options:\n` +
        "  • Check if a .zip was still produced: ls package/desktop/release/*.zip\n" +
        "    Mac users can unzip and drag the .app to Applications.\n" +
        "  • Or copy this repo to a Mac and run:\n" +
        "      npm ci && npm --prefix package/desktop install\n" +
        "      npm run desktop:pack:local\n"
      );
    }
    throw err;
  }
}

// Step 7: post-package end-to-end health check (native target only)
n++;
step(n, totalSteps, "Post-package health check (packaged sidecar → /admin/api/health)");
{
  if (isCrossBuild) {
    note(`skipped — can't run a ${platform}-${arch} app on this ${process.platform}-${process.arch} host.`);
    note("Validate on a native-arch machine before publishing this artifact.");
  } else {
    const t0 = performance.now();
    // Launches the just-built packaged app's bundled Electron as Node against the
    // packaged cli.js and asserts admin came up (better-sqlite3 loaded). Catches
    // the wrong-arch / wrong-ABI / unsigned-.node class that pre-package smoke misses.
    await run("node", ["scripts/postpack-healthcheck.mjs", platform, arch]);
    ok(t0);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
banner("Artifacts");
const releaseDir = resolve(desktop, "release");
if (!existsSync(releaseDir)) fail(`release dir missing: ${releaseDir}`);

const interesting = readdirSync(releaseDir).filter((f) => {
  const full = join(releaseDir, f);
  return statSync(full).isFile() && /\.(exe|dmg|appimage|deb|msi|zip)$/i.test(f);
});

if (interesting.length === 0) {
  fail("electron-builder produced no installer artifact. Check the log above.");
}

for (const f of interesting) {
  const full = join(releaseDir, f);
  const size = statSync(full).size;
  console.log(`  ${C.green}→${C.reset} ${C.bold}${full}${C.reset}  ${C.dim}(${humanSize(size)})${C.reset}`);
}

console.log(`\n${C.dim}Next:${C.reset}`);
if (platform === "win32") {
  console.log(`  • Double-click the .exe → Windows SmartScreen "More info" → "Run anyway"`);
  console.log(`  • System tray (^) → m2c icon appears → first run shows Settings window`);
} else if (platform === "darwin") {
  console.log(`  • Open the .dmg (or unzip the .zip) → drag mimo2codex to /Applications`);
  console.log(`  • First launch: right-click app → Open → Confirm (bypasses Gatekeeper)`);
  console.log(`  • If "App is damaged" error: run in terminal once:`);
  console.log(`        xattr -cr /Applications/mimo2codex.app`);
  console.log(`  • Menu bar (top-right) → m2c silhouette appears`);
}
if (isCrossBuild) {
  console.log(`\n${C.yellow}⚠${C.reset}  ${C.dim}This is a cross-build (${process.platform}-${process.arch} → ${platform}-${arch}). It is`);
  console.log(`   not smoke-tested on host. If the target machine can't run it,`);
  console.log(`   build natively on a ${platformLabel} machine instead.${C.reset}`);
}
console.log("");
