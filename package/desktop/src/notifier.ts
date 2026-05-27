import { Notification, shell, app } from "electron";
import { log } from "./logger.js";

let permissionAsked = false;
let permissionGranted = process.platform !== "darwin"; // Win/Linux: assumed

/**
 * Send a desktop notification if permitted. Returns true if delivered.
 * On first call on macOS, triggers the system permission prompt.
 * On denial (or any failure), returns false — caller should fall back
 * to in-app feedback (tray header text, dialog, etc.).
 */
export async function notify(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (!Notification.isSupported()) {
    log.warn("Notification not supported on this platform");
    return false;
  }

  if (process.platform === "darwin" && !permissionAsked) {
    permissionAsked = true;
    // Electron API for Notification does not expose requestPermission directly;
    // we trigger the system prompt by attempting to show one. Result is
    // recorded after the first .show() — there is no synchronous reply.
    // To detect denial, we listen for a "failed"-style absence: if 'show'
    // event never fires within 800ms, treat as denied.
    permissionGranted = await new Promise<boolean>((resolve) => {
      const probe = new Notification({ title: app.getName(), body: "Enable notifications to see sidecar alerts." });
      let settled = false;
      probe.once("show", () => { if (!settled) { settled = true; resolve(true); } });
      probe.once("failed", () => { if (!settled) { settled = true; resolve(false); } });
      probe.show();
      setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 800);
    });
    log.info(`macOS notification permission: ${permissionGranted ? "granted" : "denied or unknown"}`);
  }

  if (!permissionGranted) return false;

  const n = new Notification({ title, body });
  if (onClick) n.on("click", onClick);
  n.show();
  return true;
}

export function notifyCrash(onClickOpenLogs: () => void): void {
  void notify(
    "mimo2codex sidecar crashed",
    "Click to open logs.",
    onClickOpenLogs,
  );
  // Caller is responsible for separately reflecting state in the tray
  // header text (red ✕), so the user still sees something even if the
  // notification dropped.
}

export function openSupportLink(): void {
  shell.openExternal("https://github.com/7as0nch/mimo2codex/issues");
}
