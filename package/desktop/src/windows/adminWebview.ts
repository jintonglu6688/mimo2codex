import { BrowserWindow, app } from "electron";
import { appIconPath } from "../icons.js";

let win: BrowserWindow | null = null;

export function openAdminWindow(port: number): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "mimo2codex Admin",
    // Explicit icon — without this, the Windows taskbar shows Electron's
    // default ☒ glyph. macOS ignores `icon` for BrowserWindow (uses bundle
    // icon set by electron-builder) so this is effectively Win-only.
    icon: appIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/admin/`);
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
  win.on("closed", () => { win = null; });
}
