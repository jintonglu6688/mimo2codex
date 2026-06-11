// electron-builder afterPack hook — ad-hoc code-sign the sidecar's native
// modules and the app bundle on macOS.
//
// Why: the sidecar's better_sqlite3.node lives under
// Contents/Resources/sidecar/ (an extraResources path, NOT a normal bundle
// code location). With no signing identity (CI sets CSC_IDENTITY_AUTO_DISCOVERY
// =false), those .node files can end up unsigned. On Apple Silicon, AMFI
// rejects unsigned/foreign native code at dlopen → require('better-sqlite3')
// throws → cli.ts force-disables admin → /admin/ returns the confusing 404.
// (Intel macOS and Windows don't enforce this, which matches "mac M-chip broken,
// intel/win fine".) An ad-hoc signature (`codesign --sign -`, no certificate)
// is enough for the local machine's AMFI to accept the module.
//
// Safety: this hook NEVER throws. The post-package health check
// (scripts/postpack-healthcheck.mjs) is the authoritative gate — a bug here
// must not break every mac build, so all failures are warnings.
const { execFileSync } = require("node:child_process");
const { readdirSync, existsSync, statSync } = require("node:fs");
const { join } = require("node:path");

function collectNativeBinaries(dir, out) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectNativeBinaries(full, out);
    } else if (/\.(node|dylib)$/.test(e.name)) {
      out.push(full);
    }
  }
}

function codesignAdHoc(target) {
  // --force overwrites any existing signature; --sign - is ad-hoc (no cert);
  // --timestamp=none avoids a network call to Apple's timestamp server.
  execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", target], {
    stdio: "inherit",
  });
}

module.exports = async function afterPack(context) {
  try {
    if (context.electronPlatformName !== "darwin") return; // mac only
    if (process.platform !== "darwin") {
      console.warn("[after-pack-sign] not running on macOS — codesign unavailable, skipping.");
      return;
    }

    const productFilename = context.packager.appInfo.productFilename; // "mimo2codex"
    const appPath = join(context.appOutDir, `${productFilename}.app`);
    if (!existsSync(appPath)) {
      console.warn(`[after-pack-sign] app bundle not found at ${appPath}; skipping.`);
      return;
    }

    const sidecarDir = join(appPath, "Contents", "Resources", "sidecar");
    const natives = [];
    collectNativeBinaries(sidecarDir, natives);

    let signed = 0;
    for (const f of natives) {
      try {
        codesignAdHoc(f);
        signed++;
      } catch (e) {
        console.warn(`[after-pack-sign] failed to sign ${f}: ${e && e.message}`);
      }
    }

    // Re-seal the whole bundle ad-hoc (inside-out via --deep) so the now-signed
    // sidecar modules are covered and AMFI accepts the bundle on Apple Silicon.
    try {
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], {
        stdio: "inherit",
      });
    } catch (e) {
      console.warn(`[after-pack-sign] failed to deep-sign app bundle: ${e && e.message}`);
    }

    console.log(
      `[after-pack-sign] ad-hoc signed ${signed}/${natives.length} sidecar native module(s) + app bundle`
    );
  } catch (err) {
    console.warn(`[after-pack-sign] non-fatal error (build continues): ${err && err.message}`);
  }
};
