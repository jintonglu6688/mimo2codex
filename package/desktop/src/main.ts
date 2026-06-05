import { app, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import * as http from "node:http";
import { initLogger, log } from "./logger.js";
import { needsFirstRunSetup } from "./firstRun.js";
import { openSettings } from "./windows/settings.js";
import { SidecarManager } from "./sidecar.js";
import { findFreePort } from "./portProbe.js";
import { loadRuntime, saveRuntime } from "./runtime.js";
import { sidecarPaths } from "./paths.js";
import { notifyCrash } from "./notifier.js";
import { getDataDir } from "./dataDir.js";
import { SignalWatcher } from "./signalWatcher.js";

/**
 * Poll http://127.0.0.1:{port}/admin/ until the sidecar's HTTP server is
 * actually listening (not just spawned). Returns true when ready, false on
 * timeout. The CLI's `spawn` returning doesn't mean the HTTP server is bound —
 * import resolution + SQLite init + Express routing takes 0.5-3s, and the
 * variance is enough that a fixed setTimeout slams loadURL before the socket
 * accepts. See ERR_CONNECTION_REFUSED reports.
 */
async function waitForSidecarHttp(port: number, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/admin/", method: "HEAD", timeout: 1500 },
        (res) => {
          resolve((res.statusCode ?? 0) < 500);
          res.resume();
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Minimal JSON call to the local sidecar admin API (local mode → no auth).
function sidecarApiJson<T>(port: number, method: "GET" | "POST", path: string): Promise<T | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, timeout: 30_000, headers: { "content-type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end(method === "POST" ? "{}" : undefined);
  });
}

// On desktop launch, if Codex Desktop isn't already running, offer to open it.
async function maybePromptOpenCodex(port: number): Promise<void> {
  try {
    const status = await sidecarApiJson<{ supported?: boolean; running?: boolean }>(
      port,
      "GET",
      "/admin/api/codex-status"
    );
    if (!status || status.supported === false) return; // unsupported platform → skip
    if (status.running) {
      log.info("codex already running — no prompt");
      return;
    }
    const r = await dialog.showMessageBox({
      type: "question",
      title: "打开 Codex？",
      message: "未检测到 Codex 正在运行",
      detail: "mimo2codex 已就绪。是否现在打开 Codex 桌面端？",
      buttons: ["打开 Codex", "暂不"],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    const launched = await sidecarApiJson<{ launched?: boolean }>(port, "POST", "/admin/api/codex-launch");
    log.info("codex launch requested from startup prompt", { launched: launched?.launched });
    if (!launched || launched.launched === false) {
      void dialog.showMessageBox({
        type: "warning",
        title: "打开 Codex",
        message: "未能自动打开 Codex",
        detail: "请手动启动 Codex 桌面端。",
        buttons: ["关闭"],
      });
    }
  } catch (err) {
    log.warn("codex open prompt failed", { error: (err as Error).message });
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // Always initialize the logger at the OS-canonical userData dir first —
  // log writes happen before the user can change the data dir, and we want
  // boot logs in a stable location regardless of override state.
  const bootLogDir = app.getPath("userData");
  initLogger(bootLogDir);
  log.info("mimo2codex-desktop starting", { bootLogDir, version: app.getVersion() });

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

  // Application menu — set up later after openSettingsWindow is defined,
  // since "设置..." needs to call it directly.

  // ── Sidecar setup ───────────────────────────────────────────────────────
  // Resolve the effective data dir AFTER app.whenReady (getDataDir reads the
  // override marker at the OS-canonical userData, which is only stable then).
  let userDataDir = getDataDir();
  log.info("effective data dir", { userDataDir });

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
    extraEnv: paths.env,
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

  // First-run gate: don't start sidecar yet. We defer the actual start until
  // AFTER the tray + status listener are wired (below) so the initial
  // "starting" → "running" status transition doesn't fire into the void.
  // (Previously sidecar started here, before the listener was attached, and
  // the tray stayed stuck on "starting" for non-first-run launches.)
  const isFirstRun = needsFirstRunSetup(userDataDir);

  // Tray + actions
  const { createTray, updateStatus } = await import("./tray.js");

  const openAdminWhenReady = (): void => {
    // Poll the admin endpoint until it accepts connections, THEN open the
    // BrowserWindow. A fixed setTimeout was racing the sidecar's HTTP listen
    // on Mac (CLI startup ~1-3s) — see ERR_CONNECTION_REFUSED reports.
    void (async () => {
      const st = sidecar.status();
      if (st.kind !== "running") return;
      const ready = await waitForSidecarHttp(st.port);
      if (!ready) {
        log.warn("sidecar HTTP not ready within timeout; admin UI not auto-opened", { port: st.port });
        return;
      }
      // Re-check status — sidecar might've crashed during our poll.
      const final = sidecar.status();
      if (final.kind !== "running") return;
      void import("./windows/adminWebview.js").then(({ openAdminWindow }) =>
        openAdminWindow(final.port)
      );
    })();
  };

  const openSettingsWindow = () => openSettings({
    onSaved: async ({ showAdminUiAfterSave }) => {
      log.info("settings saved", { showAdminUiAfterSave });
      // Restart sidecar after save. The data dir may have changed (settings
      // window already migrated files + wrote the override marker), so we
      // re-resolve here and propagate to the sidecar.
      try {
        await sidecar.stop();
      } catch (err) {
        log.warn("stop before restart failed", { error: (err as Error).message });
      }
      userDataDir = getDataDir();
      const fresh = loadRuntime(userDataDir);
      const newPort = await findFreePort(fresh.port);
      saveRuntime(userDataDir, { ...fresh, port: newPort });
      sidecar.setDataDir(userDataDir);
      sidecar.setPort(newPort);
      await sidecar.start();
      // Re-target the signal watcher if the data dir moved — otherwise
      // POST /admin/api/desktop/signal would write to the new dataDir while
      // we keep watching the old one and nothing happens.
      signalWatcher.setDataDir(userDataDir);
      log.info("sidecar restarted after settings save", { port: newPort, dataDir: userDataDir, showAdminUiAfterSave });
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

  // 应用菜单（中文，跨平台）。Windows / Linux 默认菜单条全英文，且没有
  // 「设置」入口；macOS 上 Electron 自带 App 菜单但条目英文。这里给三平台
  // 统一一套中文菜单，含「设置...」入口（main 进程直接 open，无需走信号
  // 通路）。Role-based 项目（undo/cut/reload/…）我们仍显式给中文 label，
  // 不依赖系统 locale 推断。
  {
    const { Menu } = await import("electron");
    const isMac = process.platform === "darwin";
    const accelSettings = isMac ? "Cmd+," : "Ctrl+,";
    const appName = app.getName();

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac
        ? [{
            label: appName,
            submenu: [
              { role: "about" as const, label: `关于 ${appName}` },
              { type: "separator" as const },
              {
                label: "设置…",
                accelerator: accelSettings,
                click: () => openSettingsWindow(),
              },
              { type: "separator" as const },
              { role: "hide" as const, label: `隐藏 ${appName}` },
              { role: "hideOthers" as const, label: "隐藏其他" },
              { role: "unhide" as const, label: "全部显示" },
              { type: "separator" as const },
              { role: "quit" as const, label: `退出 ${appName}` },
            ],
          }]
        : []),
      {
        label: "文件",
        submenu: [
          ...(!isMac
            ? [
                {
                  label: "设置…",
                  accelerator: accelSettings,
                  click: () => openSettingsWindow(),
                },
                { type: "separator" as const },
              ]
            : []),
          {
            label: "打开管理后台",
            click: () => {
              const st = sidecar.status();
              if (st.kind === "running") {
                void import("./windows/adminWebview.js").then(({ openAdminWindow }) =>
                  openAdminWindow(st.port)
                );
              }
            },
          },
          {
            label: "查看日志",
            click: () => {
              void import("./windows/logs.js").then(({ openLogsWindow }) => openLogsWindow());
            },
          },
          { type: "separator" as const },
          ...(!isMac ? [{ role: "quit" as const, label: "退出" }] : []),
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" as const, label: "撤销" },
          { role: "redo" as const, label: "重做" },
          { type: "separator" as const },
          { role: "cut" as const, label: "剪切" },
          { role: "copy" as const, label: "复制" },
          { role: "paste" as const, label: "粘贴" },
          { role: "selectAll" as const, label: "全选" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { role: "reload" as const, label: "重新加载" },
          { role: "forceReload" as const, label: "强制重新加载" },
          ...(!app.isPackaged
            ? [{ role: "toggleDevTools" as const, label: "切换开发者工具" }]
            : []),
          { type: "separator" as const },
          { role: "resetZoom" as const, label: "实际大小" },
          { role: "zoomIn" as const, label: "放大" },
          { role: "zoomOut" as const, label: "缩小" },
          { type: "separator" as const },
          { role: "togglefullscreen" as const, label: "全屏" },
        ],
      },
      {
        label: "窗口",
        submenu: [
          { role: "minimize" as const, label: "最小化" },
          { role: "close" as const, label: "关闭窗口" },
        ],
      },
      {
        label: "帮助",
        submenu: [
          {
            label: "GitHub 主页",
            click: () => void shell.openExternal("https://github.com/7as0nch/mimo2codex"),
          },
          {
            label: "查看文档",
            click: () => void shell.openExternal("https://mimodoc.chengj.online"),
          },
          { type: "separator" as const },
          {
            label: `关于 ${appName}`,
            click: () => {
              void dialog
                .showMessageBox({
                  type: "info",
                  title: `关于 ${appName}`,
                  message: `${appName} v${app.getVersion()}`,
                  detail:
                    "Codex ↔ MiMo / DeepSeek / 通用 provider 的本地代理。\n\nhttps://github.com/7as0nch/mimo2codex",
                  buttons: ["GitHub", "关闭"],
                })
                .then((r) => {
                  if (r.response === 0) void shell.openExternal("https://github.com/7as0nch/mimo2codex");
                });
            },
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    log.info("application menu installed", { platform: process.platform });
  }

  // Signal watcher (A2 — admin UI → desktop Settings entry).
  // Admin React UI can't IPC into Electron main directly (no preload bridge
  // on the admin BrowserWindow), so it POSTs to the sidecar which writes a
  // file in dataDir; we watch that file here and dispatch.
  const signalWatcher = new SignalWatcher(userDataDir, {
    openSettings: openSettingsWindow,
  });
  signalWatcher.start();

  // Status updates push to tray (Task 7.3). MUST be registered before the
  // deferred sidecar.start() below — otherwise the "starting" / "running"
  // transition emitted by spawnOnce fires with no listener attached and
  // the tray header is stuck on the initial "starting" label.
  sidecar.on("status", (st) => {
    log.info("sidecar status", st);
    updateStatus(trayActions, st);
    if (st.kind === "crashed") {
      notifyCrash(trayActions.openLogs);
    }
  });

  // Now safe to launch sidecar (skipped on first run — user fills key first).
  if (!isFirstRun) {
    await sidecar.start();
    saveRuntime(userDataDir, { ...runtime, port });
  }

  // Decide what to surface to the user on launch:
  //
  //   • First run (no usable provider key)  → open Settings, sidecar held back
  //   • Autostart-launched (system boot)    → stay tray-only, no window
  //   • Normal manual launch                → open admin UI so the user has
  //                                            something to interact with;
  //                                            otherwise the tray icon on Win
  //                                            11 (folded by default) makes
  //                                            the app feel like it didn't
  //                                            launch at all
  const isAutostartLaunched = process.argv.includes("--autostart-launched");
  if (isFirstRun) {
    log.info("first run → opening settings (sidecar not started)");
    openSettingsWindow();
  } else if (!isAutostartLaunched) {
    log.info("normal launch → opening admin UI");
    openAdminWhenReady();
    // Once the sidecar is reachable, offer to open Codex if it isn't running.
    void (async () => {
      const st = sidecar.status();
      if (st.kind !== "running") return;
      const ready = await waitForSidecarHttp(st.port);
      if (ready) await maybePromptOpenCodex(st.port);
    })();
  } else {
    log.info("autostart launch → staying tray-only");
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
        signalWatcher.stop();
      } catch (err) {
        log.warn("signal watcher stop on quit failed", { error: (err as Error).message });
      }
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
