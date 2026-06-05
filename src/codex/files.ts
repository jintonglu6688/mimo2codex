import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertInsideCodexDir, authJsonPath, codexDir } from "./paths.js";

// Dedicated subfolder for auth.json / config.toml backups, so the dozens of
// `*.bak.*` snapshots don't clutter the top-level `~/.codex/` listing the
// Codex app and CLI also read. Still inside codexDir → assertInsideCodexDir
// stays valid and the restore path can write back without relaxing the guard.
export function backupsDir(): string {
  return path.join(codexDir(), ".m2c-backups");
}

// The two live files we ever back up. Used to recognize legacy sibling
// backups during the one-time migration.
const BACKED_UP_BASENAMES = ["auth.json", "config.toml"];

// Move any legacy sibling backups (`~/.codex/<file>.bak.*`, the pre-v0.6.0
// layout) into `.m2c-backups/`. Idempotent and cheap — once migrated there's
// nothing left to match, so it degrades to a single readdir. Called lazily
// from listBackups so it runs the first time anything reads backup state.
export function migrateLegacyBackups(): void {
  const dir = codexDir();
  if (!existsSync(dir)) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!BACKED_UP_BASENAMES.some((b) => name.startsWith(`${b}.bak.`))) continue;
    try {
      mkdirSync(backupsDir(), { recursive: true });
      renameSync(path.join(dir, name), path.join(backupsDir(), name));
    } catch {
      // best-effort; a locked file shouldn't block the read that triggered us
    }
  }
}

// Write `contents` to `filePath` atomically: write to a sibling temp file
// then renameSync over the target. renameSync is atomic on POSIX and on
// Windows for files on the same volume — which is always the case here
// since temp + target share a parent dir.
export function atomicWrite(filePath: string, contents: string): void {
  assertInsideCodexDir(filePath);
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`
  );
  writeFileSync(tmp, contents, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup if rename fails (e.g. Codex has the file open).
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// Copy `filePath` to `<filePath>.bak.<ts>.<pid>`. When `opts.preserve` is
// true, append a `.preserve` suffix — `pruneBackups` then refuses to drop
// it under any keep limit. We use this for the *first* apply that
// overwrites an external auth.json (i.e. a real OpenAI login) so the user
// can always undo their way back to that state, no matter how many times
// they switch models afterwards.
// Returns the backup path, or null if the source file does not exist.
export function backupFile(
  filePath: string,
  ts: number,
  opts?: { preserve?: boolean }
): string | null {
  assertInsideCodexDir(filePath);
  if (!existsSync(filePath)) return null;
  const tail = opts?.preserve ? ".preserve" : "";
  mkdirSync(backupsDir(), { recursive: true });
  const backup = path.join(
    backupsDir(),
    `${path.basename(filePath)}.bak.${ts}.${process.pid}${tail}`
  );
  copyFileSync(filePath, backup);
  return backup;
}

export interface BackupEntry {
  path: string;
  ts: number;
  // True when the backup filename ends in `.preserve`. Preserved backups
  // survive `pruneBackups` so the user's original real-OpenAI config never
  // ages out as they keep switching models.
  preserved: boolean;
}

// Enumerate all `<basename>.bak.<ts>[.<pid>][.preserve]` siblings of
// `filePath`. Sorted by ts descending so callers can treat index 0 as
// "most recent".
export function listBackups(filePath: string): BackupEntry[] {
  assertInsideCodexDir(filePath);
  migrateLegacyBackups();
  const dir = backupsDir();
  if (!existsSync(dir)) return [];
  const base = path.basename(filePath);
  const prefix = `${base}.bak.`;
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    // rest looks like "<ts>", "<ts>.<pid>", "<ts>.<pid>.preserve", or
    // "<ts>.preserve". Parse the leading integer for ts; flag preserve
    // when the suffix is present.
    const m = /^(\d+)/.exec(rest);
    if (!m) continue;
    entries.push({
      path: path.join(dir, name),
      ts: Number(m[1]),
      preserved: name.endsWith(".preserve"),
    });
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries;
}

// Keep `keep` newest non-preserved backups; preserved backups are NEVER
// pruned. Safe to call right after generating a new backup: the just-
// created one sorts first by ts so it can never fall outside the window.
export function pruneBackups(filePath: string, keep = 10): void {
  const all = listBackups(filePath);
  const unpreserved = all.filter((e) => !e.preserved);
  for (const entry of unpreserved.slice(keep)) {
    try {
      rmSync(entry.path, { force: true });
    } catch {
      /* best-effort; missing or locked files shouldn't block apply */
    }
  }
}

// Delete all backup files (any pid, any preserve flag) for the given ts.
// Used by the admin UI to let users clean up specific backups. Returns
// the number of files deleted.
export function deleteBackupsAt(filePath: string, ts: number): number {
  let n = 0;
  for (const entry of listBackups(filePath)) {
    if (entry.ts !== ts) continue;
    try {
      rmSync(entry.path, { force: true });
      n++;
    } catch {
      /* best-effort */
    }
  }
  return n;
}

export type AuthJsonOwner = "mimo2codex" | "external" | "missing";

// Detect whether ~/.codex/auth.json was last written by us. We stamp a
// sentinel value ("mimo2codex-local") in OPENAI_API_KEY at apply time;
// anything else (real OpenAI key, malformed JSON, …) is treated as foreign
// and triggers the UI's overwrite confirmation.
export function detectAuthJsonOwner(): AuthJsonOwner {
  const p = authJsonPath();
  if (!existsSync(p)) return "missing";
  try {
    const text = readFileSync(p, "utf-8");
    const json = JSON.parse(text) as { OPENAI_API_KEY?: unknown };
    if (json && json.OPENAI_API_KEY === "mimo2codex-local") return "mimo2codex";
    return "external";
  } catch {
    return "external";
  }
}

// Read raw config.toml content if present. Returned as-is for the UI to
// surface to the user; we don't parse TOML server-side because Codex's
// config schema is wide and we only need a best-effort current-model hint.
export function readConfigTomlIfExists(): string | null {
  const p = path.join(codexDir(), "config.toml");
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}
