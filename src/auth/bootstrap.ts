// First-run admin notice. When authMode=on and the users table is empty we
// log a one-line banner pointing at /admin/ so the operator knows where to
// finish setup. No token, no file — the SPA detects needsBootstrap=true via
// /admin/api/auth/me and auto-routes to the registration form. Whoever
// submits first becomes admin (Jellyfin / Nextcloud / Synology pattern).

import type { Config } from "../config.js";
import { log } from "../util/log.js";
import { countUsers } from "../db/users.js";

export function logFirstRunBannerIfNeeded(cfg: Config): void {
  if (cfg.authMode === "off") return;
  try {
    if (countUsers() > 0) return;
    const host = cfg.host === "0.0.0.0" ? "localhost" : cfg.host;
    log.warn(
      [
        "============================================================",
        "  First-run admin setup needed",
        `  Open: http://${host}:${cfg.port}/admin/`,
        "  Fill in admin username + password to claim the account.",
        "============================================================",
      ].join("\n")
    );
  } catch (err) {
    log.debug(`first-run banner skipped: ${(err as Error).message}`);
  }
}
