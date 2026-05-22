// CommonJS preload script. Must be `.cts` so tsc emits `.cjs` — Electron's
// default sandboxed preload context cannot load ESM. We do NOT import from
// ipc.ts (ESM) here either; the channel name is duplicated below so this
// file stays a self-contained CJS leaf.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const IPC_CHANNEL = "m2c-desktop";

contextBridge.exposeInMainWorld("m2c", {
  send: (msg: unknown): void => {
    ipcRenderer.send(IPC_CHANNEL, msg);
  },
  on: (handler: (msg: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: unknown) => handler(msg);
    ipcRenderer.on(IPC_CHANNEL, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNEL, listener);
  },
  openPath: (p: string): void => {
    ipcRenderer.send(IPC_CHANNEL, { type: "shell:openPath", payload: { path: p } });
  },
});
