import { BrowserWindow, ipcMain, shell, app } from "electron";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNEL, type RendererToMain, type MainToRenderer } from "../ipc.js";
import { appIconPath } from "../icons.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/src/windows → dist/src → dist
const distDir = resolve(__dirname, "..", "..");

let win: BrowserWindow | null = null;
let subscribers: Array<(msg: MainToRenderer) => void> = [];

// Ring buffer of recent sidecar output. Populated by broadcastLog() since
// startup, so when the user opens the Logs window LATER (which they always
// do — sidecar starts before any window exists) we can replay history and
// they actually see something instead of an empty pane waiting for the next
// log line from an idle sidecar.
interface BufferedLine {
  line: string;
  channel: "stdout" | "stderr";
}
const BUFFER_SIZE = 500;
const buffer: BufferedLine[] = [];

export function openLogsWindow(): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 800,
    height: 500,
    title: "mimo2codex 日志",
    icon: appIconPath(),
    webPreferences: {
      preload: join(distDir, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  // Vite multi-entry layout: dist/renderer/renderer/logs/index.html
  win.loadFile(join(distDir, "renderer", "renderer", "logs", "index.html"));
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });

  const onMsg = (_e: Electron.IpcMainEvent, msg: RendererToMain) => {
    if (msg.type === "logs:subscribe") {
      const send = (m: MainToRenderer) => win?.webContents.send(IPC_CHANNEL, m);
      // Snapshot the buffer BEFORE registering, then push — keeps the
      // historic replay separate from the live stream. Worst case is one
      // duplicate line if broadcastLog fires between snapshot and push;
      // we accept that over missing a line.
      const snapshot = buffer.slice();
      subscribers.push(send);
      for (const item of snapshot) {
        send({ type: "logs:line", payload: { line: item.line, channel: item.channel } });
      }
    } else if (msg.type === "logs:unsubscribe") {
      subscribers = [];
    }
  };
  ipcMain.on(IPC_CHANNEL, onMsg);
  win.on("closed", () => {
    win = null;
    subscribers = [];
    ipcMain.removeListener(IPC_CHANNEL, onMsg);
  });
}

/** Called by main when sidecar emits stdout/stderr. */
export function broadcastLog(line: string, channel: "stdout" | "stderr"): void {
  // Always append to the ring buffer, even when no window is open — that's
  // the whole point: the user opens logs window later and gets recent
  // history. Drop the oldest line once we hit the cap.
  buffer.push({ line, channel });
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  for (const s of subscribers) s({ type: "logs:line", payload: { line, channel } });
}

/** Test hook: reset the buffer between tests. Not exported elsewhere. */
export function __resetLogBufferForTests(): void {
  buffer.length = 0;
}

export function openLogFolder(): void {
  void shell.openPath(join(app.getPath("userData"), "logs"));
}
