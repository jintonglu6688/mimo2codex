import { nativeImage, type NativeImage } from "electron";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/src/ → package/desktop/ → package/ → repo root → package/{win,mac}
// dist/src/icons.js  →  ../../..  =  repo root
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

export function trayIcon(): NativeImage {
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(join(repoRoot, "package/mac/tray-Template.png"));
    img.setTemplateImage(true);
    return img;
  }
  // Windows / Linux: use colored ico
  return nativeImage.createFromPath(join(repoRoot, "package/win/tray.ico"));
}
