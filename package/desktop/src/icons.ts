import { nativeImage, app, type NativeImage } from "electron";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a path to a branding asset (tray icon, app icon, etc.) that works
 * in both dev runs (file lives in the repo) and packaged builds (file is
 * placed under `Resources/branding-{win,mac}/` by electron-builder's
 * `extraResources` config — see `package/desktop/electron-builder.yml`).
 */
function brandingPath(file: string, subdir: "win" | "mac"): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, `branding-${subdir}`, file);
  }
  // Dev: dist/src → dist → package/desktop → package → repo root
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  return join(repoRoot, `package/${subdir}`, file);
}

export function trayIcon(): NativeImage {
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(brandingPath("tray-Template.png", "mac"));
    img.setTemplateImage(true);
    return img;
  }
  // Windows / Linux: use colored ico
  return nativeImage.createFromPath(brandingPath("tray.ico", "win"));
}

/**
 * Returns the path to icon.ico for Windows BrowserWindow icon prop, or
 * undefined on other platforms (macOS uses the bundle icon via .icns).
 */
export function appIconPath(): string | undefined {
  if (process.platform === "win32") {
    return brandingPath("icon.ico", "win");
  }
  return undefined;
}
