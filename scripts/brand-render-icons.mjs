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
// because sharp-cli@4 (libvips-backed) doesn't decode .ico without an
// ImageMagick loader. The PNGs were extracted once with System.Drawing on
// Windows — see package/brand/contributed-by-starlsd93/readme.md.
//
// Sizing strategy: render Windows app icon (16..256) from the 256 PNG; the
// tray (16/32/48) from the 64 PNG so small sizes downsample from a closer
// native source. Mac .icns gets a 1024 upscale from the 512 PNG.
// Use repo-relative paths — sharp-cli on Windows chokes on backslash-style
// absolute paths from `resolve()`, and we already set `cwd: root` on every
// execSync below. Forward slashes work for both shells (cmd / pwsh / bash).
const contribAppPng256 = "package/brand/contributed-by-starlsd93/Mimo_Orange_256.png";
const contribAppPng512 = "package/brand/contributed-by-starlsd93/Mimo_Orange_512.png";
const contribTrayPng64 = "package/brand/contributed-by-starlsd93/Mimo_Orange_64.png";

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

// ── Win tray.ico (small, downsampled from contributor's 64x64 orange .ico) ──
execSync(`npx --yes sharp-cli@4 -i "${contribTrayPng64}" -o .tmp-tray-16.png resize 16 16`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribTrayPng64}" -o .tmp-tray-32.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribTrayPng64}" -o .tmp-tray-48.png resize 48 48`, { stdio: "inherit", cwd: root });
execSync(`npx --yes png-to-ico@2 .tmp-tray-16.png .tmp-tray-32.png .tmp-tray-48.png > package/win/tray.ico`, { stdio: "inherit", cwd: root, shell: true });

// ── Win icon.ico (app icon, multi-size from contributor's 256x256 .ico) ────
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-16.png resize 16 16`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-32.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-48.png resize 48 48`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-64.png resize 64 64`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-128.png resize 128 128`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i "${contribAppPng256}" -o .tmp-app-256.png resize 256 256`, { stdio: "inherit", cwd: root });
execSync(`npx --yes png-to-ico@2 .tmp-app-16.png .tmp-app-32.png .tmp-app-48.png .tmp-app-64.png .tmp-app-128.png .tmp-app-256.png > package/win/icon.ico`, { stdio: "inherit", cwd: root, shell: true });

// Cleanup temp files
const tmpFiles = [
  ".tmp-tray-mono.svg",
  ".tmp-tray-16.png", ".tmp-tray-32.png", ".tmp-tray-48.png",
  ".tmp-app-16.png", ".tmp-app-32.png", ".tmp-app-48.png",
  ".tmp-app-64.png", ".tmp-app-128.png", ".tmp-app-256.png",
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
