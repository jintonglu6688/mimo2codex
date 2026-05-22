// Generates tray icons from package/brand/logo.svg.
// - Mac: tray-Template.png (16,32 @1x and @2x = 16,32,32,64) black silhouette
// - Win: tray.ico (16,32,48 multi-size, colored) + icon.ico (same)
// Run: npm run brand:icons
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const brandSvg = resolve(root, "package/brand/logo.svg");

mkdirSync(resolve(root, "package/win"), { recursive: true });
mkdirSync(resolve(root, "package/mac"), { recursive: true });

// Mac template: monochrome silhouette
// Strategy: render SVG with all fills replaced to black, transparent bg
const svg = readFileSync(brandSvg, "utf8");
const monoSvg = svg
  .replace(/<linearGradient[\s\S]*?<\/linearGradient>/g, "")
  .replace(/fill="url\(#bg\)"/g, 'fill="none"')
  .replace(/fill="url\(#gloss\)"/g, 'fill="none"')
  .replace(/fill="#FFFFFF"/g, 'fill="#000000"')
  .replace(/stroke="#FFFFFF"/g, 'stroke="#000000"');
const monoPath = resolve(root, ".tmp-mono.svg");
writeFileSync(monoPath, monoSvg, "utf8");

// Use sharp-cli (already a transient dep via brand:render)
execSync(`npx --yes sharp-cli@4 -i .tmp-mono.svg -o package/mac/tray-Template.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i .tmp-mono.svg -o package/mac/tray-Template@2x.png resize 64 64`, { stdio: "inherit", cwd: root });

// Win tray.ico: render PNG at 16/32/48 then combine with png-to-ico
execSync(`npx --yes sharp-cli@4 -i package/brand/logo.svg -o .tmp-tray-16.png resize 16 16`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i package/brand/logo.svg -o .tmp-tray-32.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i package/brand/logo.svg -o .tmp-tray-48.png resize 48 48`, { stdio: "inherit", cwd: root });
execSync(`npx --yes png-to-ico@2 .tmp-tray-16.png .tmp-tray-32.png .tmp-tray-48.png > package/win/tray.ico`, { stdio: "inherit", cwd: root, shell: true });
execSync(`npx --yes png-to-ico@2 .tmp-tray-16.png .tmp-tray-32.png .tmp-tray-48.png > package/win/icon.ico`, { stdio: "inherit", cwd: root, shell: true });

// Cleanup temp files
for (const f of [".tmp-mono.svg", ".tmp-tray-16.png", ".tmp-tray-32.png", ".tmp-tray-48.png"]) {
  try { rmSync(resolve(root, f), { force: true }); } catch { /* best-effort */ }
}

console.log("brand icons generated:");
console.log("  package/win/tray.ico");
console.log("  package/win/icon.ico");
console.log("  package/mac/tray-Template.png + @2x");
