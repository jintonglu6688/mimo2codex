// Post-package end-to-end health check for the desktop sidecar.
//
// Why this exists: the pre-package smoke test in build-sidecar.mjs loads
// better-sqlite3 from the *unbundled* sidecar dir. It can't see failures that
// only appear in the *packaged* app — wrong-ABI / wrong-arch native modules,
// macOS code-signing/AMFI kills, or a broken resources path. Those manifest at
// runtime as: openDb() throws → cli.ts force-disables admin → /admin/ returns a
// confusing 404 (the mac-arm64 regression this guards against).
//
// This launches the PACKAGED sidecar via the PACKAGED Electron binary
// (ELECTRON_RUN_AS_NODE=1, exactly how the desktop shell spawns it) and asserts
// GET /admin/api/health → 200 { adminEnabled: true }. If better-sqlite3 can't
// load in the real packaged layout, health reports adminEnabled:false and this
// fails the build.
//
// Usage:  node scripts/postpack-healthcheck.mjs <platform> <arch>
//   platform: win32 | darwin     arch: x64 | arm64
// Only meaningful for the NATIVE target (you can't run a foreign-arch app);
// the caller decides whether to invoke it.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { get as httpGet } from "node:http";
import { readFileSync, openSync, readSync, closeSync } from "node:fs";
import { detectNativeArch } from "./detectNativeArch.mjs";

// Read just the file header (enough for Mach-O/PE/ELF arch detection) — the
// Electron binary is 100+MB, so never read it whole just to check its arch.
function archOf(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    return detectNativeArch(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const releaseDir = resolve(root, "package/desktop/release");

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;

function fail(msg) {
  console.error(`\n[postpack] ✗ ${msg}\n`);
  process.exit(1);
}

// Recursively find the first path whose basename matches `name` (bounded depth).
function findUnder(dir, name, depth = 5) {
  if (depth < 0 || !existsSync(dir)) return null;
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

// electron-builder's unpacked dir name is per platform AND arch, but the exact
// naming (mac/ vs mac-arm64/, default-arch quirks) varies by version/host. So
// rather than guess the name, we enumerate all plausible dirs and pick the one
// whose bundled better_sqlite3.node ACTUALLY matches the requested arch. This is
// what makes the check robust — a generic "first match" grabbed the wrong arch
// (mac/=x64 before mac-arm64/; win-arm64-unpacked/ before win-unpacked/) and
// then tried to run a foreign-arch binary → spawn UNKNOWN / silent no-start.
function candidateUnpackedDirs() {
  if (platform === "darwin") return ["mac-arm64", "mac-x64", "mac", "mac-universal"];
  if (platform === "win32") return ["win-arm64-unpacked", "win-x64-unpacked", "win-unpacked"];
  return ["linux-arm64-unpacked", "linux-x64-unpacked", "linux-unpacked"];
}

// Arch implied by the unpacked dir / app name (mac-arm64, win-x64-unpacked, …).
function archHintFromName(p) {
  const n = p.toLowerCase();
  if (n.includes("arm64") || n.includes("aarch64")) return "arm64";
  if (n.includes("x64") || n.includes("x86_64")) return "x64";
  return "unknown";
}

function appPathsFor(baseDir) {
  if (platform === "darwin") {
    const app = join(baseDir, "mimo2codex.app");
    return {
      label: app,
      electronBin: join(app, "Contents", "MacOS", "mimo2codex"),
      cliEntry: join(app, "Contents", "Resources", "sidecar", "dist", "cli.js"),
      sidecarRoot: join(app, "Contents", "Resources", "sidecar"),
    };
  }
  const exeName = platform === "win32" ? "mimo2codex.exe" : "mimo2codex";
  return {
    label: baseDir,
    electronBin: join(baseDir, exeName),
    cliEntry: join(baseDir, "resources", "sidecar", "dist", "cli.js"),
    sidecarRoot: join(baseDir, "resources", "sidecar"),
  };
}

// Resolve { electronBin, cliEntry, sidecarRoot } for THIS platform+arch by
// matching the bundled native module's real arch, not the dir name.
function resolvePackagedSidecar() {
  if (!existsSync(releaseDir)) fail(`release dir missing: ${releaseDir} (run electron-builder first)`);
  const bases = candidateUnpackedDirs()
    .map((n) => join(releaseDir, n))
    .filter(existsSync);
  if (!bases.length) {
    fail(
      `no unpacked dir under ${releaseDir}\n` +
        `        present: ${readdirSync(releaseDir).filter((f) => statSync(join(releaseDir, f)).isDirectory()).join(", ") || "(none)"}`
    );
  }
  const seen = [];
  for (const base of bases) {
    const paths = appPathsFor(base);
    if (!existsSync(paths.electronBin)) continue;
    // Select by the EXECUTABLE's arch — that's what must run on this host. (The
    // bundled .node can be wrong-arch relative to its shell — that's the very bug
    // we hunt — so it's not a reliable selector. precheckNativeArch checks it.)
    paths.exeArch = archOf(paths.electronBin);
    if (paths.exeArch === arch) return paths; // exact arch match wins
    seen.push(paths);
  }
  // Secondary: if the exe arch is undetectable (e.g. a universal Mach-O that runs
  // on both arches anyway), fall back to the dir-name arch hint so we still pick
  // the right .node to validate.
  const byHint = seen.filter((p) => p.exeArch === "unknown" && archHintFromName(p.label) === arch);
  if (byHint.length === 1) return byHint[0];
  // Or a sole candidate whose exe arch is simply unknown.
  if (seen.length === 1 && seen[0].exeArch === "unknown") return seen[0];
  fail(
    `no runnable ${arch} app found under ${releaseDir}\n` +
      `        candidates: ${seen.map((m) => `${m.label} (exe=${m.exeArch})`).join("; ") || "(none with an electron binary)"}`
  );
}

// Fail fast (and clearly) if the bundled better_sqlite3.node is the wrong CPU
// arch — that's the issue #69 / mac-arm64 class, and catching it statically
// gives a crisper message than a runtime load failure.
function precheckNativeArch(sidecarRoot) {
  const nodeFile = findUnder(sidecarRoot, "better_sqlite3.node");
  if (!nodeFile) {
    console.warn(`[postpack] note: better_sqlite3.node not found under ${sidecarRoot} (skipping arch precheck)`);
    return;
  }
  const detected = detectNativeArch(readFileSync(nodeFile));
  if (detected !== "unknown" && detected !== arch) {
    fail(
      `bundled better_sqlite3.node is ${detected} but this is the ${arch} package.\n` +
        `        ${nodeFile}\n` +
        `        Wrong-arch native module — it will fail to load at runtime (the /admin/ 404 class).`
    );
  }
  console.log(`[postpack] native arch precheck OK — better_sqlite3.node is ${detected}`);
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

function fetchJson(url, timeoutMs = 2000) {
  return new Promise((res) => {
    const req = httpGet(url, (r) => {
      let buf = "";
      r.on("data", (d) => (buf += d));
      r.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(buf);
        } catch {
          /* ignore */
        }
        res({ status: r.statusCode, json });
      });
    });
    req.on("error", () => res({ status: 0, json: null }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      res({ status: 0, json: null });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (platform !== process.platform || arch !== process.arch) {
    console.log(
      `[postpack] skipping — cross-target ${platform}-${arch} can't run on host ${process.platform}-${process.arch}.`
    );
    return; // not a failure: caller should only invoke for the native target
  }

  const { label, electronBin, cliEntry, sidecarRoot } = resolvePackagedSidecar();
  if (!existsSync(electronBin)) fail(`packaged Electron binary missing: ${electronBin}`);
  if (!existsSync(cliEntry)) fail(`packaged sidecar cli.js missing: ${cliEntry}`);
  precheckNativeArch(sidecarRoot);

  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "m2c-postpack-"));
  console.log(`[postpack] launching packaged sidecar: ${label}`);
  console.log(`[postpack]   ${electronBin} ${cliEntry} --port ${port}`);

  const child = spawn(electronBin, [cliEntry, "--port", String(port), "--data-dir", dataDir], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MIMO2CODEX_DESKTOP_PARENT: "1",
      // cli.js exits(2) on startup without a provider key. We only verify the
      // HTTP server + admin DB come up (no upstream calls are made), so a dummy
      // MiMo key satisfies the presence check. Don't override a real one if set.
      MIMO_API_KEY: process.env.MIMO_API_KEY || "sk-postpack-healthcheck-dummy",
      // Skip the startup npm/update probe so the check stays offline + fast.
      MIMO2CODEX_NO_UPDATE_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  let spawnError = null;
  // Async spawn failures (bad exe format, ENOENT, AMFI kill) arrive here, not as
  // a throw — capture so the diagnostic includes them instead of a bare timeout.
  child.on("error", (e) => {
    spawnError = e;
    childLog += `\n[spawn error] ${e && e.message}`;
  });
  child.stdout?.on("data", (b) => (childLog += b));
  child.stderr?.on("data", (b) => (childLog += b));

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  // Poll health for up to ~25s (cold start + DB open).
  const url = `http://127.0.0.1:${port}/admin/api/health`;
  let last = { status: 0, json: null };
  for (let i = 0; i < 50; i++) {
    if (spawnError || child.exitCode !== null) break;
    last = await fetchJson(url);
    if (last.status === 200) break;
    await sleep(500);
  }

  cleanup();

  if (last.status !== 200) {
    fail(
      `health probe never returned 200 (last status ${last.status}).\n` +
        (spawnError ? `        spawn failed: ${spawnError.message}\n` : "") +
        (child.exitCode !== null && child.exitCode !== 0
          ? `        sidecar exited early with code ${child.exitCode}.\n`
          : "        The packaged sidecar didn't come up.\n") +
        `        --- sidecar output ---\n${childLog}`
    );
  }
  if (last.json && last.json.adminEnabled === false) {
    fail(
      `admin is DISABLED in the packaged app — better-sqlite3 failed to load.\n` +
        `        reason: ${last.json.reason} — ${last.json.message}\n` +
        `        This is the wrong-arch / wrong-ABI / unsigned-.node failure class.\n` +
        `        --- sidecar output ---\n${childLog}`
    );
  }
  console.log(
    `[postpack] ✓ packaged ${platform}-${arch} admin UI is healthy ` +
      `(adminEnabled=${last.json ? last.json.adminEnabled : "?"})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
