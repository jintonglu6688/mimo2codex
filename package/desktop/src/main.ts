import { app, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { initLogger, log } from "./logger.js";
import { needsFirstRunSetup } from "./firstRun.js";
import { openSettings } from "./windows/settings.js";
import { SidecarManager } from "./sidecar.js";
import { findFreePort } from "./portProbe.js";
import { loadRuntime, saveRuntime } from "./runtime.js";
import { sidecarPaths } from "./paths.js";
import { notifyCrash } from "./notifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const userDataDir = app.getPath("userData");
  initLogger(userDataDir);
  log.info("mimo2codex-desktop starting", { userDataDir, version: app.getVersion() });

  // Single-instance lock (Task 4.3.1 — A1)
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log.info("another instance already holds the lock, exiting");
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    log.info("second-instance attempt blocked");
  });

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  // Tray-resident: don't quit just because the last window closed.
  app.on("window-all-closed", (e: Electron.Event) => e.preventDefault());

  await app.whenReady();
  log.info("electron ready");

  // macOS application menu — Edit roles enable Cmd+C/V in BrowserWindow text
  // inputs (Task 6.1.1 — A4).
  if (process.platform === "darwin") {
    const { Menu } = await import("electron");
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.getName(),
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]));
  }

  // ── Sidecar setup ───────────────────────────────────────────────────────
  const runtime = loadRuntime(userDataDir);
  const port = await findFreePort(runtime.port);
  if (port !== runtime.port) {
    log.warn("preferred port busy → using next free", { preferred: runtime.port, actual: port });
  }
  const paths = sidecarPaths();
  log.info("sidecar paths", paths);

  const sidecar = new SidecarManager({
    binPath: paths.node,
    extraArgs: [paths.cliEntry],
    dataDir: userDataDir,
    port,
  });
  const { broadcastLog } = await import("./windows/logs.js");
  sidecar.on("stdout", (s: string) => {
    process.stderr.write(`[sidecar.out] ${s}`);
    broadcastLog(s, "stdout");
  });
  sidecar.on("stderr", (s: string) => {
    process.stderr.write(`[sidecar.err] ${s}`);
    broadcastLog(s, "stderr");
  });

  // First-run gate: don't start sidecar until user has provided a key.
  const isFirstRun = needsFirstRunSetup(userDataDir);
  if (!isFirstRun) {
    await sidecar.start();
    saveRuntime(userDataDir, { ...runtime, port });
  }

  // Tray + actions
  const { createTray, updateStatus } = await import("./tray.js");

  const openAdminWhenReady = (): void => {
    // Tiny delay so the sidecar's HTTP listener is actually up
    setTimeout(() => {
      const st = sidecar.status();
      if (st.kind === "running") {
        void import("./windows/adminWebview.js").then(({ openAdminWindow }) =>
          openAdminWindow(st.port)
        );
      }
    }, 800);
  };

  const openSettingsWindow = () => openSettings({
    onSaved: async ({ showAdminUiAfterSave }) => {
      log.info("settings saved", { showAdminUiAfterSave });
      // Restart sidecar after save (port may have changed, env definitely did).
      try {
        await sidecar.stop();
      } catch (err) {
        log.warn("stop before restart failed", { error: (err as Error).message });
      }
      const fresh = loadRuntime(userDataDir);
      const newPort = await findFreePort(fresh.port);
      saveRuntime(userDataDir, { ...fresh, port: newPort });
      sidecar.setPort(newPort);
      await sidecar.start();
      log.info("sidecar restarted after settings save", { port: newPort, showAdminUiAfterSave });
      if (showAdminUiAfterSave) openAdminWhenReady();
    },
    onCancelInFirstRun: () => {
      log.info("first-run cancelled → quitting");
      app.quit();
    },
  });

  const trayActions = {
    openAdminInBrowser: () => {
      const st = sidecar.status();
      if (st.kind === "running") {
        void shell.openExternal(`http://127.0.0.1:${st.port}/admin/`);
      }
    },
    openAdminInApp: () => {
      const st = sidecar.status();
      if (st.kind === "running") {
        void import("./windows/adminWebview.js").then(({ openAdminWindow }) =>
          openAdminWindow(st.port)
        );
      }
    },
    openSettings: openSettingsWindow,
    openLogs: () => {
      void import("./windows/logs.js").then(({ openLogsWindow }) => openLogsWindow());
    },
    restartSidecar: async () => {
      await sidecar.stop();
      await sidecar.start();
    },
  };
  createTray(trayActions);
  log.info("tray created");

  // Status updates push to tray (Task 7.3).
  sidecar.on("status", (st) => {
    log.info("sidecar status", st);
    updateStatus(trayActions, st);
    if (st.kind === "crashed") {
      notifyCrash(trayActions.openLogs);
    }
  });

  if (isFirstRun) {
    log.info("first run → opening settings (sidecar not started)");
    openSettingsWindow();
  }

  // Graceful shutdown — give sidecar a chance to stop before exiting.
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    if (sidecar.status().kind === "crashed") return;
    e.preventDefault();
    quitting = true;
    void (async () => {
      try {
        await sidecar.stop();
      } catch (err) {
        log.warn("sidecar stop on quit failed", { error: (err as Error).message });
      }
      app.exit(0);
    })();
  });

  // Passive desktop-update check (Task 5.5).
  setTimeout(() => { void checkForDesktopUpdate(); }, 5_000);
  setInterval(() => { void checkForDesktopUpdate(); }, 24 * 60 * 60 * 1000);
}

async function checkForDesktopUpdate(): Promise<void> {
  try {
    const { fetchLatestDesktopTag, parseDesktopVersion, isMinorAhead } =
      await import("./updateCheck.js");
    const tag = await fetchLatestDesktopTag();
    if (!tag) return;
    const latest = parseDesktopVersion(tag);
    const current = parseDesktopVersion(`v${app.getVersion()}-desktop`);
    if (!latest || !current) return;
    if (isMinorAhead(current, latest)) {
      log.info("desktop update available", { current: app.getVersion(), latest: tag });
      const { setUpdateAvailable } = await import("./tray.js");
      setUpdateAvailable(true);
    }
  } catch (err) {
    log.warn("update check threw", { error: (err as Error).message });
  }
}

main().catch((err) => {
  log.error("fatal in main", { error: (err as Error).message });
  process.exit(1);
});

void __dirname;
