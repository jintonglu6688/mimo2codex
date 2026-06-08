import type { Config } from "../config.js";
import { deleteLogsBefore, deleteOldestLogs, getDbSizeBytes, vacuumDb } from "../db/logs.js";
import { getSetting, setSetting } from "../db/settings.js";

export type LogBodyMode = "full" | "errors-only" | "off";

export interface LogBodies {
  requestBody: string | null;
  responseBody: string | null;
}

const VALID_BODY_MODES = new Set<LogBodyMode>(["full", "errors-only", "off"]);

export function parseLogBodyMode(raw: string | null | undefined): LogBodyMode | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  return VALID_BODY_MODES.has(normalized as LogBodyMode)
    ? (normalized as LogBodyMode)
    : null;
}

export function parseLogRetentionDays(raw: string | null | undefined): number | null | undefined {
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (normalized === "0" || normalized === "off" || normalized === "false") return null;
  const n = Number(normalized);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

export function resolveLogBodyMode(cfg: Config): LogBodyMode {
  if (cfg.logBodyModeFromCli) return cfg.logBodyModeFromCli;
  try {
    return parseLogBodyMode(getSetting("logging.bodyMode")) ?? "full";
  } catch {
    return "full";
  }
}

export function resolveLogRetentionDays(cfg: Config): number | null {
  if (cfg.logRetentionDaysFromCli !== undefined) return cfg.logRetentionDaysFromCli;
  try {
    return parseLogRetentionDays(getSetting("logging.retentionDays")) ?? null;
  } catch {
    return null;
  }
}

export function applyLogBodyMode(
  mode: LogBodyMode,
  statusCode: number,
  bodies: LogBodies
): LogBodies {
  if (mode === "off") return { requestBody: null, responseBody: null };
  if (mode === "errors-only" && statusCode < 400) {
    return { requestBody: null, responseBody: null };
  }
  return bodies;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VACUUM_THROTTLE_MS = DAY_MS; // at most one automatic vacuum per day

export function parseMaxDbSizeMb(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = raw.trim().toLowerCase();
  if (n === "" || n === "0" || n === "off" || n === "false") return null;
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return null;
  return v;
}

export function resolveMaxDbSizeMb(): number | null {
  try {
    return parseMaxDbSizeMb(getSetting("logging.maxDbSizeMb"));
  } catch {
    return null;
  }
}

export interface LogMaintenanceResult {
  retentionDays: number | null;
  removed: number;
  removedBySize: number;
  vacuumed: boolean;
}

// Auto-vacuum is throttled so a large db isn't rebuilt on every 6-hour tick.
function shouldAutoVacuum(now: number): boolean {
  const last = Number(getSetting("logging.lastVacuumAt"));
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last >= VACUUM_THROTTLE_MS;
}

export function runLogMaintenance(cfg: Config, now = Date.now()): LogMaintenanceResult {
  const retentionDays = resolveLogRetentionDays(cfg);
  if (!cfg.adminEnabled) {
    return { retentionDays, removed: 0, removedBySize: 0, vacuumed: false };
  }
  // 1. Age-based retention.
  let removed = 0;
  if (retentionDays !== null) {
    removed = deleteLogsBefore(now - retentionDays * DAY_MS);
  }
  // 2. Hard size ceiling (issue #67): trim the oldest half whenever the db
  //    blows past maxDbSizeMb, regardless of age. Best-effort — converges over
  //    successive maintenance ticks.
  let removedBySize = 0;
  const maxMb = resolveMaxDbSizeMb();
  if (maxMb !== null && getDbSizeBytes().total > maxMb * 1024 * 1024) {
    removedBySize = deleteOldestLogs(0.5);
  }
  // 3. Reclaim disk after meaningful deletions, throttled to once a day.
  let vacuumed = false;
  if (removed + removedBySize > 0 && shouldAutoVacuum(now)) {
    vacuumDb();
    setSetting("logging.lastVacuumAt", String(now));
    vacuumed = true;
  }
  return { retentionDays, removed, removedBySize, vacuumed };
}
