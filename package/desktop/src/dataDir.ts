// User-configurable data location.
//
// Strategy: the OS default `app.getPath("userData")` is "sacred" — it always
// contains *at most* a single marker file `data-dir-override.txt` whose
// contents are the absolute path to the EFFECTIVE data directory. All real
// state (.env, runtime.json, data.db, logs/) lives at the effective dir.
//
// This lets the user move their data to e.g. an external drive or a synced
// folder, without losing the pointer if they reinstall the desktop app (the
// marker stays at the OS-canonical location).
import { app } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const OVERRIDE_FILE = "data-dir-override.txt";

/** OS-canonical userData dir. Never changes; only contains the override marker. */
function defaultDir(): string {
  return app.getPath("userData");
}

/** Returns the effective data dir (custom location if override is set, else default). */
export function getDataDir(): string {
  const overridePath = join(defaultDir(), OVERRIDE_FILE);
  if (existsSync(overridePath)) {
    try {
      const p = readFileSync(overridePath, "utf8").trim();
      if (p && existsSync(p) && statSync(p).isDirectory()) return p;
    } catch { /* fall through to default */ }
  }
  return defaultDir();
}

/**
 * Change the effective data dir.
 *
 * Migrates the existing data (except the override marker itself) from the old
 * location to the new one, then writes the override marker. Idempotent on
 * no-op changes.
 *
 * Throws if newPath is unwritable or if the migration partially fails.
 */
export function setDataDir(newPath: string): { migrated: boolean; oldDir: string; newDir: string } {
  const resolved = resolve(newPath);
  const oldDir = getDataDir();
  if (oldDir === resolved) return { migrated: false, oldDir, newDir: resolved };

  // Ensure new dir is writable
  mkdirSync(resolved, { recursive: true });

  // Sanity: writability probe
  const probe = join(resolved, ".m2c-write-probe");
  try {
    writeFileSync(probe, String(Date.now()), "utf8");
  } catch (err) {
    throw new Error(`Data dir not writable: ${resolved}. Cause: ${(err as Error).message}`);
  } finally {
    try { require("node:fs").unlinkSync(probe); } catch { /* best-effort */ }
  }

  // Migrate everything from old → new (except the override marker)
  if (existsSync(oldDir)) {
    for (const entry of readdirSync(oldDir)) {
      if (entry === OVERRIDE_FILE) continue;
      const srcPath = join(oldDir, entry);
      const dstPath = join(resolved, entry);
      cpSync(srcPath, dstPath, { recursive: true, force: false, errorOnExist: false });
    }
  }

  // Write override marker at DEFAULT location, pointing to the new dir.
  // (We deliberately do NOT delete old files — user can clean up manually,
  // safer than auto-deleting if migration was incomplete.)
  const defaultD = defaultDir();
  mkdirSync(defaultD, { recursive: true });
  writeFileSync(join(defaultD, OVERRIDE_FILE), resolved, "utf8");

  return { migrated: true, oldDir, newDir: resolved };
}

/** Where the override marker lives (always at the OS default userData). */
export function overrideMarkerPath(): string {
  return join(defaultDir(), OVERRIDE_FILE);
}
