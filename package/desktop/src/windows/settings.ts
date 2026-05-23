import { BrowserWindow, ipcMain, app, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadRuntime, saveRuntime } from "../runtime.js";
import { readEnv, writeEnv } from "../envFile.js";
import { needsFirstRunSetup } from "../firstRun.js";
import { setAutostart } from "../autostart.js";
import { IPC_CHANNEL, type RendererToMain, type MainToRenderer } from "../ipc.js";
import { log } from "../logger.js";
import { appIconPath } from "../icons.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/src/windows → dist/src → dist
const distDir = resolve(__dirname, "..", "..");

let win: BrowserWindow | null = null;

export interface SettingsCallbacks {
  /** Called after Save & Restart — main wires this to sidecar restart */
  onSaved: (opts: { showAdminUiAfterSave: boolean }) => Promise<void>;
  /** Called when user cancels in first-run mode (= equivalent to Quit) */
  onCancelInFirstRun: () => void;
}

export function openSettings(cb: SettingsCallbacks): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "mimo2codex Settings",
    show: false,
    icon: appIconPath(),
    webPreferences: {
      preload: join(distDir, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  // Vite multi-entry preserves the input's relative path → renderer/settings/index.html
  win.loadFile(join(distDir, "renderer", "renderer", "settings", "index.html"));
  win.once("ready-to-show", () => win!.show());
  // Auto-open DevTools when running unpackaged (dev / local-pack smoke).
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });

  const send = (msg: MainToRenderer) => win?.webContents.send(IPC_CHANNEL, msg);
  const userDataDir = app.getPath("userData");

  const onRendererMsg = (_e: Electron.IpcMainEvent, msg: RendererToMain) => {
    if (!win || !msg) return;
    if (msg.type === "settings:load") {
      send({
        type: "settings:loaded",
        payload: {
          runtime: loadRuntime(userDataDir),
          env: readEnv(userDataDir),
          isFirstRun: needsFirstRunSetup(userDataDir),
          userDataDir,
        },
      });
    } else if (msg.type === "settings:save") {
      log.info("settings saved by user", {
        port: msg.payload.runtime.port,
        envKeys: Object.keys(msg.payload.env),
      });
      saveRuntime(userDataDir, msg.payload.runtime);
      setAutostart(msg.payload.runtime.autostart);
      writeEnv(userDataDir, msg.payload.env);
      win.close();
      cb.onSaved({ showAdminUiAfterSave: msg.payload.showAdminUiAfterSave }).catch((err) => {
        log.error("onSaved failed", { error: (err as Error).message });
      });
    } else if (msg.type === "settings:cancel") {
      win.close();
      if (msg.payload.isFirstRun) cb.onCancelInFirstRun();
    } else if (msg.type === "shell:openPath") {
      void shell.openPath(msg.payload.path);
    }
  };
  ipcMain.on(IPC_CHANNEL, onRendererMsg);
  win.on("closed", () => {
    win = null;
    ipcMain.removeListener(IPC_CHANNEL, onRendererMsg);
  });
}
