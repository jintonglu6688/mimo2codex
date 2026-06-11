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

// Resolve { electronBin, cliEntry } from the electron-builder unpacked output.
function resolvePackagedSidecar() {
  if (!existsSync(releaseDir)) fail(`release dir missing: ${releaseDir} (run electron-builder first)`);
  if (platform === "darwin") {
    // release/mac-arm64/mimo2codex.app  (or release/mac/ for x64)
    const app = findUnder(releaseDir, "mimo2codex.app");
    if (!app) fail(`mimo2codex.app not found under ${releaseDir}`);
    return {
      label: `${app}`,
      electronBin: join(app, "Contents", "MacOS", "mimo2codex"),
      cliEntry: join(app, "Contents", "Resources", "sidecar", "dist", "cli.js"),
    };
  }
  if (platform === "win32") {
    // release/win-unpacked/mimo2codex.exe
    const exe = findUnder(releaseDir, "mimo2codex.exe");
    if (!exe) fail(`mimo2codex.exe not found under ${releaseDir}`);
    const unpacked = dirname(exe);
    return {
      label: `${unpacked}`,
      electronBin: exe,
      cliEntry: join(unpacked, "resources", "sidecar", "dist", "cli.js"),
    };
  }
  // linux: release/linux-unpacked/mimo2codex
  const bin = findUnder(releaseDir, "mimo2codex");
  if (!bin) fail(`linux unpacked binary not found under ${releaseDir}`);
  const unpacked = dirname(bin);
  return {
    label: `${unpacked}`,
    electronBin: bin,
    cliEntry: join(unpacked, "resources", "sidecar", "dist", "cli.js"),
  };
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

  const { label, electronBin, cliEntry } = resolvePackagedSidecar();
  if (!existsSync(electronBin)) fail(`packaged Electron binary missing: ${electronBin}`);
  if (!existsSync(cliEntry)) fail(`packaged sidecar cli.js missing: ${cliEntry}`);

  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "m2c-postpack-"));
  console.log(`[postpack] launching packaged sidecar: ${label}`);
  console.log(`[postpack]   ${electronBin} ${cliEntry} --port ${port}`);

  const child = spawn(electronBin, [cliEntry, "--port", String(port), "--data-dir", dataDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", MIMO2CODEX_DESKTOP_PARENT: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
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
    if (child.exitCode !== null) break;
    last = await fetchJson(url);
    if (last.status === 200) break;
    await sleep(500);
  }

  cleanup();

  if (last.status !== 200) {
    fail(
      `health probe never returned 200 (last status ${last.status}).\n` +
        `        The packaged sidecar didn't come up.\n        --- sidecar output ---\n${childLog}`
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
