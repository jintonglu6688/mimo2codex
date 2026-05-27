import { Tray, Menu, app, shell, dialog } from "electron";
import { trayIcon } from "./icons.js";
import type { SidecarStatus } from "../shared/types.js";
import { setAutostart, getAutostart } from "./autostart.js";

let tray: Tray | null = null;

export interface TrayActions {
  openAdminInBrowser: () => void;
  openAdminInApp: () => void;
  openSettings: () => void;
  openLogs: () => void;
  restartSidecar: () => void;
}

// Persisted across rebuilds so setUpdateAvailable (Task 5.5) can re-render
// without needing the caller to repeat actions/status.
let lastActions: TrayActions | null = null;
let lastStatus: SidecarStatus | null = null;
let updateAvailable = false;

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  rebuildMenu(actions, { kind: "starting" });
  return tray;
}

export function updateStatus(actions: TrayActions, status: SidecarStatus): void {
  rebuildMenu(actions, status);
}

/** Toggles the "Update available" entry in the tray menu (Task 5.5). */
export function setUpdateAvailable(v: boolean): void {
  updateAvailable = v;
  if (lastActions && lastStatus) rebuildMenu(lastActions, lastStatus);
}

function statusLabel(s: SidecarStatus): string {
  if (s.kind === "running") return `●  mimo2codex · running on :${s.port}`;
  if (s.kind === "starting") return `○  mimo2codex · starting...`;
  return `✕  mimo2codex · sidecar crashed`;
}

function tooltipText(s: SidecarStatus): string {
  if (s.kind === "running") return `mimo2codex · :${s.port} · running`;
  if (s.kind === "starting") return `mimo2codex · starting...`;
  return `mimo2codex · crashed`;
}

function rebuildMenu(actions: TrayActions, status: SidecarStatus): void {
  if (!tray) return;
  lastActions = actions;
  lastStatus = status;
  tray.setToolTip(tooltipText(status));
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: statusLabel(status), enabled: false },
    { type: "separator" },
    {
      label: "Open Admin UI in browser",
      enabled: status.kind === "running",
      click: actions.openAdminInBrowser,
    },
    {
      label: "Open Admin UI in app...",
      enabled: status.kind === "running",
      click: actions.openAdminInApp,
    },
    { type: "separator" },
    { label: "Settings...", click: actions.openSettings },
    { label: "Show logs...", click: actions.openLogs },
    { type: "separator" },
    {
      label: "Start on system boot",
      type: "checkbox",
      checked: getAutostart(),
      click: (item) => setAutostart(item.checked),
    },
    { type: "separator" },
    { label: "Restart sidecar", click: actions.restartSidecar },
    ...(updateAvailable
      ? [{
          label: "●  Update available — Get latest",
          click: () => shell.openExternal("https://mimodoc.chengj.online/download"),
        } as Electron.MenuItemConstructorOptions]
      : []),
    {
      label: "About",
      click: () => {
        dialog.showMessageBox({
          type: "info",
          title: "About mimo2codex",
          message: `mimo2codex v${app.getVersion()}`,
          detail: "Local proxy for OpenAI Codex ↔ MiMo / DeepSeek / generic.\n\nhttps://github.com/7as0nch/mimo2codex",
          buttons: ["GitHub", "Close"],
        }).then((r) => {
          if (r.response === 0) shell.openExternal("https://github.com/7as0nch/mimo2codex");
        });
      },
    },
    {
      label: "Quit",
      click: () => {
        // Confirm before killing the sidecar — an accidental click here
        // would drop any in-flight Codex session the user has open.
        dialog.showMessageBox({
          type: "question",
          title: "Quit mimo2codex?",
          message: "Quit mimo2codex?",
          detail:
            "The sidecar will stop and any active Codex sessions through this proxy will be interrupted.",
          buttons: ["Quit", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        }).then((r) => {
          if (r.response === 0) app.quit();
        });
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
