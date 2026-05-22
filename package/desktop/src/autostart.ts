import { app } from "electron";

export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: enabled ? ["--autostart-launched"] : [],
  });
}

export function getAutostart(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
