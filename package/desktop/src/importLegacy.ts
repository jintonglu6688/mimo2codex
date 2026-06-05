import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readEnv, writeEnv, hasUsableKey } from "./envFile.js";
import { log } from "./logger.js";
import type { LegacyEnvProbe } from "../shared/types.js";

// Legacy CLI install path resolution.
//
// `npm install -g mimo2codex` writes the user's .env to a CLI-side data
// directory (default ~/.mimo2codex/, but the user may have migrated to a
// custom path via the admin UI's "Local Data Directory → Migrate" flow,
// which writes `~/.mimo2codex-pointer.json` pointing at the new location).
//
// To find the user's REAL active legacy .env we mirror the sidecar's own
// resolution order (see src/db/dataDir.ts + src/db/dataDirPointer.ts):
//   1. pointer file at ~/.mimo2codex-pointer.json — wins when present and
//      its `dataDir` field is readable AND the directory exists
//   2. default ~/.mimo2codex/
//
// Note we do NOT honor the CLI's $MIMO2CODEX_DATA_DIR env var: a CLI-side
// shell env doesn't survive into the desktop's process tree, and probing
// it would require the user to launch the desktop from the same shell.
// Documented in the import dialog so users can manually copy if needed.
//
// `homeDir` is exposed so unit tests can point at a tmpdir without
// monkey-patching `os.homedir`.
const POINTER_FILE_NAME = ".mimo2codex-pointer.json";

function pointerTargetDir(homeDir: string): string | null {
  const pointerPath = join(homeDir, POINTER_FILE_NAME);
  if (!existsSync(pointerPath)) return null;
  try {
    const text = readFileSync(pointerPath, "utf-8");
    const parsed = JSON.parse(text) as { dataDir?: unknown };
    if (typeof parsed.dataDir === "string" && parsed.dataDir.length > 0) {
      return parsed.dataDir;
    }
    return null;
  } catch (err) {
    log.warn("legacy pointer file unreadable, falling back to default", {
      pointerPath,
      error: (err as Error).message,
    });
    return null;
  }
}

function legacyEnvDir(homeDir: string = homedir()): string {
  // Pointer wins when present + still points at an existing dir. We require
  // existsSync on the dir so a stale pointer (user deleted the migrated
  // location but forgot to remove the pointer file) doesn't make us miss
  // the default-location .env that may still hold their original keys.
  const pointed = pointerTargetDir(homeDir);
  if (pointed && existsSync(pointed)) return pointed;
  return join(homeDir, ".mimo2codex");
}

function legacyEnvPath(homeDir: string = homedir()): string {
  return join(legacyEnvDir(homeDir), ".env");
}

// Env keys we know about — everything else (e.g. user-set HTTP_PROXY,
// MIMO2CODEX_MASTER_KEY) is also imported, but these are the ones we
// surface in the UI preview so the user knows what they're getting.
const KNOWN_KEYS = new Set([
  "MIMO_API_KEY",
  "MIMO_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DS_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GENERIC_API_KEY",
  "GENERIC_BASE_URL",
  "GENERIC_DEFAULT_MODEL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "MIMO2CODEX_MASTER_KEY",
]);

/**
 * Probe the legacy CLI install for a `.env` worth importing. Returns null if
 * there's nothing to surface (file missing, empty, or no usable keys). The
 * desktop's data dir is passed so we can short-circuit when the legacy file
 * IS the active dir (e.g. user explicitly pointed the desktop at the same
 * folder via the data-dir override marker).
 *
 * `homeDir` defaults to `os.homedir()`; tests pass a tmpdir.
 */
export function detectLegacyEnv(
  currentDataDir: string,
  homeDir: string = homedir()
): LegacyEnvProbe | null {
  const sourcePath = legacyEnvPath(homeDir);
  if (!existsSync(sourcePath)) return null;

  // If the legacy path is already where the desktop is reading from, there's
  // nothing to "import" — same file would be both source and target.
  if (resolve(sourcePath) === resolve(join(currentDataDir, ".env"))) return null;

  const legacy = readEnv(legacyEnvDir(homeDir));
  const keys = Object.keys(legacy).filter((k) => legacy[k] && legacy[k].length > 0);
  if (keys.length === 0) return null;

  // Order the preview: known keys first (alphabetically), then anything else.
  const known = keys.filter((k) => KNOWN_KEYS.has(k)).sort();
  const other = keys.filter((k) => !KNOWN_KEYS.has(k)).sort();
  return { sourcePath, keys: [...known, ...other] };
}

export interface ImportResult {
  imported: Record<string, string>;
  skipped: Record<string, string>;
  sourcePath: string;
}

/**
 * Copy keys from `~/.mimo2codex/.env` into `{targetDataDir}/.env`. Keys that
 * already exist in the target with a non-placeholder value are SKIPPED — we
 * never silently overwrite a key the desktop user already set.
 *
 * Returns:
 *   - `imported`: keys we wrote (legacy value)
 *   - `skipped`:  keys we left alone because the desktop already had a value
 */
export function importLegacyEnv(
  targetDataDir: string,
  homeDir: string = homedir()
): ImportResult {
  const sourcePath = legacyEnvPath(homeDir);
  if (!existsSync(sourcePath)) {
    return { imported: {}, skipped: {}, sourcePath };
  }
  const legacy = readEnv(legacyEnvDir(homeDir));
  const target = readEnv(targetDataDir);

  const imported: Record<string, string> = {};
  const skipped: Record<string, string> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (!v || v.length === 0) continue;
    if (hasUsableKey(target, k)) {
      skipped[k] = v;
      continue;
    }
    imported[k] = v;
  }
  if (Object.keys(imported).length > 0) {
    writeEnv(targetDataDir, imported);
  }
  return { imported, skipped, sourcePath };
}

// Exposed so unit tests can mock the legacy path lookup. Renderer / main code
// uses the wrappers above.
export const __test__ = {
  legacyEnvPath,
  KNOWN_KEYS,
};

// Re-read the legacy file's full key/value map for the "import" IPC path —
// the renderer holds redacted previews only; main does the actual disk read.
export function readLegacyFull(homeDir: string = homedir()): Record<string, string> {
  if (!existsSync(legacyEnvPath(homeDir))) return {};
  return readEnv(legacyEnvDir(homeDir));
}
