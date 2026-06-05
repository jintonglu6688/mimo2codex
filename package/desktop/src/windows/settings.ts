import { BrowserWindow, ipcMain, app, shell, dialog } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadRuntime, saveRuntime } from "../runtime.js";
import { readEnv, writeEnv } from "../envFile.js";
import { needsFirstRunSetup } from "../firstRun.js";
import { setAutostart } from "../autostart.js";
import { IPC_CHANNEL, type RendererToMain, type MainToRenderer } from "../ipc.js";
import { log } from "../logger.js";
import { appIconPath } from "../icons.js";
import { getDataDir, setDataDir } from "../dataDir.js";
import { detectLegacyEnv, importLegacyEnv } from "../importLegacy.js";

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

  const onRendererMsg = (_e: Electron.IpcMainEvent, msg: RendererToMain) => {
    if (!win || !msg) return;
    if (msg.type === "settings:load") {
      const currentDir = getDataDir();
      send({
        type: "settings:loaded",
        payload: {
          runtime: loadRuntime(currentDir),
          env: readEnv(currentDir),
          isFirstRun: needsFirstRunSetup(currentDir),
          userDataDir: currentDir,
          legacyEnv: detectLegacyEnv(currentDir),
        },
      });
    } else if (msg.type === "settings:importLegacy") {
      const currentDir = getDataDir();
      try {
        const result = importLegacyEnv(currentDir);
        log.info("legacy env imported", {
          sourcePath: result.sourcePath,
          importedCount: Object.keys(result.imported).length,
          skippedCount: Object.keys(result.skipped).length,
        });
        send({
          type: "settings:legacyImported",
          payload: {
            imported: result.imported,
            skipped: result.skipped,
            sourcePath: result.sourcePath,
          },
        });
      } catch (err) {
        log.error("legacy env import failed", { error: (err as Error).message });
        void dialog.showMessageBox(win, {
          type: "error",
          title: "Couldn't import legacy config",
          message: "Failed to import the legacy CLI config.",
          detail: (err as Error).message,
        });
      }
    } else if (msg.type === "settings:chooseDataDir") {
      void dialog.showOpenDialog(win, {
        title: "Choose data location",
        defaultPath: getDataDir(),
        properties: ["openDirectory", "createDirectory"],
      }).then((result) => {
        const picked = (!result.canceled && result.filePaths[0]) ? result.filePaths[0] : null;
        send({ type: "settings:dataDirChosen", payload: { path: picked } });
      });
    } else if (msg.type === "settings:save") {
      log.info("settings saved by user", {
        port: msg.payload.runtime.port,
        envKeys: Object.keys(msg.payload.env),
        dataDir: msg.payload.dataDir,
      });
      // Step 1: migrate data dir if it changed. Do this FIRST so subsequent
      // saveRuntime/writeEnv go to the new location.
      const currentDir = getDataDir();
      let effectiveDir = currentDir;
      if (msg.payload.dataDir && resolve(msg.payload.dataDir) !== currentDir) {
        try {
          const result = setDataDir(msg.payload.dataDir);
          log.info("data dir migrated", result);
          effectiveDir = result.newDir;
        } catch (err) {
          log.error("data dir migration failed", { error: (err as Error).message });
          // Show error to user. Don't close window — let them try again.
          void dialog.showMessageBox(win, {
            type: "error",
            title: "Couldn't move data location",
            message: "Failed to migrate data to the new location.",
            detail: (err as Error).message,
          });
          return;
        }
      }
      saveRuntime(effectiveDir, msg.payload.runtime);
      setAutostart(msg.payload.runtime.autostart);
      writeEnv(effectiveDir, msg.payload.env);
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
