import { existsSync, readFileSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

// File-based signal channel from the sidecar back to Electron main.
//
// Architecture (A2 — admin UI → settings entry):
//   - The Admin UI runs in a BrowserWindow with NO preload bridge — it loads
//     `http://127.0.0.1:<port>/admin/` like a normal web page, so it can't
//     call Electron IPC.
//   - The Admin React app POSTs `/admin/api/desktop/signal` with the desired
//     action; the sidecar writes <dataDir>/.desktop-signal.json.
//   - This module watches that file and dispatches actions to the desktop
//     main process (e.g. open Settings).
//
// Why a file (not a UNIX socket / named pipe): zero extra deps, works
// identically on Win / Mac / Linux, and the sidecar already has free write
// access to dataDir. The "signal" file is overwritten on each request, then
// deleted by this watcher after dispatch — so a stale signal from a previous
// session never fires post-restart.

export interface SignalActions {
  /** Action: "open-settings" → bring up the Electron Settings window. */
  openSettings: () => void;
}

interface SignalEvent {
  action?: string;
  ts?: number;
}

export class SignalWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private path: string;

  constructor(dataDir: string, private readonly actions: SignalActions) {
    this.path = join(dataDir, ".desktop-signal.json");
  }

  start(): void {
    // Wipe any leftover from a previous run — we never replay across restarts.
    try {
      if (existsSync(this.path)) unlinkSync(this.path);
    } catch (err) {
      log.warn("signal watcher: failed to clear stale signal", {
        path: this.path,
        error: (err as Error).message,
      });
    }

    // fs.watch can fire multiple events per write (size + content). Debounce
    // to coalesce, then read once.
    try {
      this.watcher = watch(
        // Watch the directory, not the file itself — the file may not exist
        // yet on macOS, where watching a non-existent file throws ENOENT
        // synchronously instead of waiting.
        join(this.path, ".."),
        { persistent: false },
        (_event, filename) => {
          if (filename !== ".desktop-signal.json") return;
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => this.processSignal(), 50);
        }
      );
      log.info("signal watcher started", { path: this.path });
    } catch (err) {
      log.error("signal watcher: failed to start", {
        path: this.path,
        error: (err as Error).message,
      });
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Re-target the watcher when the user moves dataDir from the settings window. */
  setDataDir(newDir: string): void {
    this.stop();
    this.path = join(newDir, ".desktop-signal.json");
    this.start();
  }

  private processSignal(): void {
    if (!existsSync(this.path)) return;
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (err) {
      log.warn("signal watcher: read failed", { error: (err as Error).message });
      return;
    }
    let evt: SignalEvent;
    try {
      evt = JSON.parse(raw) as SignalEvent;
    } catch {
      log.warn("signal watcher: signal file is not valid JSON, ignoring", {
        preview: raw.slice(0, 200),
      });
      // Wipe the bad file so we don't keep retrying it on every directory event.
      try { unlinkSync(this.path); } catch { /* ignore */ }
      return;
    }
    // Always delete the file AFTER dispatch attempt so a future write
    // re-triggers the watcher cleanly.
    try { unlinkSync(this.path); } catch { /* ignore */ }

    if (evt.action === "open-settings") {
      log.info("signal received: open-settings");
      this.actions.openSettings();
    } else {
      log.warn("signal watcher: unknown action", { action: evt.action });
    }
  }
}
