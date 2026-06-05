// Generates tray + app icons from the contributor-supplied artwork in
// package/brand/contributed-by-starlsd93/ (orange MiMo cloud, PR #43).
//
// Source files (binary .ico, multi-size set):
// - Mimo_Orange_256.ico → Win app icon, Mac .icns (1024 upscale), Mac dock
// - Mimo_Orange_64.ico  → Win tray.ico (small)
// - package/brand/tray.svg → STILL used for Mac tray-Template.png ONLY
//   (macOS template images must be monochrome silhouettes — extracting one
//   from a colored bitmap is lossy, so we keep the simple SVG silhouette
//   approach for that specific output).
//
// Why bitmap source instead of an SVG: the contributor delivered a raster
// .ico, no SVG. Building an SVG approximation introduces visual drift; a
// raster pipeline rasterizes-from-raster which is identity at native sizes.
//
// Outputs:
// - Win: tray.ico (small, contributor's 64x64 design),
//        icon.ico (multi-size from contributor's 256x256)
// - Mac: tray-Template.png + @2x (mono silhouette, from tray.svg — unchanged),
//        icon.icns (from contributor's design, via logo-1024.png upscale)
// Run: npm run brand:icons
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";


const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const brandTraySvg = resolve(root, "package/brand/tray.svg");
const brandPng1024 = resolve(root, "package/brand/logo-1024.png");
// Contributor-supplied raster sources (PR #43 — @starlsd93-sudo).
// The contributor delivered .ico files; we keep PNG mirrors alongside them
// (extracted once with System.Drawing on Windows — see the readme.md in
// that dir) because sharp-cli@4's libvips backend doesn't decode .ico.
// Only the 512 PNG is used directly — for the .icns upscale to 1024.
// Use a repo-relative path; sharp-cli on Windows chokes on backslash-style
// absolute paths, and execSync calls below all set `cwd: root`.
const contribAppPng512 = "package/brand/contributed-by-starlsd93/Mimo_Orange_512.png";

mkdirSync(resolve(root, "package/win"), { recursive: true });
mkdirSync(resolve(root, "package/mac"), { recursive: true });

// ── Mac tray template (monochrome silhouette of the SIMPLIFIED tray icon) ──
// macOS native template-image rules require a B/W silhouette; the colored
// orange artwork is unsuitable as a Mac menu-bar template. We keep using
// the simple tray.svg silhouette here.
const traySvg = readFileSync(brandTraySvg, "utf8");
const trayMonoSvg = traySvg
  .replace(/fill="#4F6CFB"/g, 'fill="none"')
  .replace(/fill="#FFFFFF"/g, 'fill="#000000"');
const trayMonoPath = resolve(root, ".tmp-tray-mono.svg");
writeFileSync(trayMonoPath, trayMonoSvg, "utf8");

execSync(`npx --yes sharp-cli@4 -i .tmp-tray-mono.svg -o package/mac/tray-Template.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i .tmp-tray-mono.svg -o package/mac/tray-Template@2x.png resize 64 64`, { stdio: "inherit", cwd: root });

// ── Win tray.ico ──────────────────────────────────────────────────────────
// Same logic as icon.ico — copy the contributor's 64x64 .ico directly.
// Windows tray icons render at 16x16 / 20x20 (with DPI scaling), so 64 →
// downsample is fine and avoids any PNG-vs-BMP encoding compatibility risk.
const contribTrayIcoBuf = readFileSync(resolve(root, "package/brand/contributed-by-starlsd93/Mimo_Orange_64.ico"));
writeFileSync(resolve(root, "package/win/tray.ico"), contribTrayIcoBuf);

// ── Win icons: dual-file strategy ──────────────────────────────────────────
// We ship TWO different .ico files because NSIS and rcedit have very
// different size tolerances:
//
//   package/win/icon.ico            (512 native, 1.08 MB) — used as
//     `win.icon` in electron-builder.yml. electron-builder feeds this to
//     `rcedit` which rewrites the LAUNCHED app's .exe icon resource.
//     rcedit handles large icons fine. Result: installed app's icon
//     (Explorer preview pane, taskbar at HiDPI, title bar, jump list)
//     downsamples from a 512 native source — crisp at any display scale.
//
//   package/win/installer-icon.ico  (256 native, 270 KB) — used as
//     `nsis.installerIcon` / `nsis.installerHeaderIcon` / `nsis.uninstallerIcon`.
//     NSIS makensis chokes on icons > ~500 KB inside its resource section
//     (assistedInstaller.nsh expansion fails at installer compile). The
//     256 entry is within NSIS's safe range and matches the v0.5.6 working
//     build's icon size. Visible only during install/uninstall flow.
//
// Both files are direct copies of the contributor's BMP-encoded .icos —
// no re-encoding, max compatibility.
const contribAppIcoBuf = readFileSync(resolve(root, "package/brand/contributed-by-starlsd93/Mimo_Orange_512.ico"));
writeFileSync(resolve(root, "package/win/icon.ico"), contribAppIcoBuf);

const contribInstallerIcoBuf = readFileSync(resolve(root, "package/brand/contributed-by-starlsd93/Mimo_Orange_256.ico"));
writeFileSync(resolve(root, "package/win/installer-icon.ico"), contribInstallerIcoBuf);

// Cleanup temp files. Only .tmp-tray-mono.svg is still actively used (for
// the Mac template image). The .tmp-tray-*.png / .tmp-app-*.png entries
// stay in the cleanup list as a safety net in case an older copy of this
// script left them behind on a developer machine.
const tmpFiles = [
  ".tmp-tray-mono.svg",
  ".tmp-tray-16.png", ".tmp-tray-32.png", ".tmp-tray-48.png",
  ".tmp-app-16.png", ".tmp-app-32.png", ".tmp-app-48.png",
  ".tmp-app-64.png", ".tmp-app-128.png", ".tmp-app-256.png",
  ".tmp-app-512.png",
];
for (const f of tmpFiles) {
  try { rmSync(resolve(root, f), { force: true }); } catch { /* best-effort */ }
}

// Mac app icon (.icns) — generated via png2icons. We always (re)render
// logo-1024.png from the contributor's largest .ico so the .icns reflects
// the same orange artwork. Force re-render: any stale committed PNG of the
// old purple design would otherwise leak into the .icns build output.
// Use the 512 PNG (largest contributor source) for the .icns upscale — less
// blur than upscaling 256 → 1024.
console.log("[icons] (re)rendering package/brand/logo-1024.png from contributor's 512 PNG...");
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng512}" -o package/brand/logo-1024.png resize 1024 1024 --withoutEnlargement=false`, { cwd: root, stdio: "inherit" });

console.log("[icons] generating package/mac/icon.icns via png2icons...");
// png2icons CLI: png2icons <input> <output-prefix> -icns
// It writes <output-prefix>.icns. We pass a tmp prefix and rename to final path.
const icnsTmp = resolve(root, "package/mac/.tmp-icon");
try {
  execSync(`npx --yes png2icons@2 "${brandPng1024}" "${icnsTmp}" -icns -bc`, { cwd: root, stdio: "inherit" });
  // png2icons output is <prefix>.icns
  execSync(process.platform === "win32"
    ? `move /Y "${icnsTmp}.icns" "${resolve(root, "package/mac/icon.icns")}"`
    : `mv -f "${icnsTmp}.icns" "${resolve(root, "package/mac/icon.icns")}"`,
    { cwd: root, stdio: "inherit", shell: true });
} catch (err) {
  console.warn("[icons] WARN: icon.icns generation failed:", err.message);
  console.warn("[icons] Mac packaging will fall back to logo-1024.png if needed.");
}

console.log("brand icons generated:");
console.log("  package/win/tray.ico");
console.log("  package/win/icon.ico");
console.log("  package/mac/tray-Template.png + @2x");
console.log("  package/mac/icon.icns");
