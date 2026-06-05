import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  atomicWrite,
  backupFile,
  deleteBackupsAt,
  detectAuthJsonOwner,
  listBackups,
  pruneBackups,
  readConfigTomlIfExists,
  type AuthJsonOwner,
  type BackupEntry,
} from "./files.js";
import { assertInsideCodexDir, authJsonPath, codexDir, configTomlPath } from "./paths.js";
import {
  buildCcSwitchFiles,
  buildProviderTomlPatch,
  type HostPort,
  type SnippetTarget,
} from "../setup/snippets.js";
import { mergeCodexProviderToml } from "./tomlMerge.js";

const BACKUP_KEEP = 10;

export interface ApplyResult {
  backupTs: number;
  authBackup: string | null;
  tomlBackup: string | null;
  authJsonOwnerBefore: AuthJsonOwner;
  // True when this backup was tagged `.preserve` and is exempt from
  // automatic pruning — happens whenever the previous auth.json belonged
  // to someone else (real OpenAI login or other foreign owner).
  preserved: boolean;
}

// Write ~/.codex/auth.json and ~/.codex/config.toml for the requested
// (provider, model) pair, after first backing up whatever was there. Both
// backups share the same `ts` suffix so restoreCodex can pair them.
//
// When the previous auth.json belonged to an external owner (real OpenAI
// login or anything that's not the mimo2codex sentinel), the backup is
// tagged as preserved so subsequent applies can never prune it. That way
// the user can switch models 50 times and still always have a one-click
// restore back to their original real-Codex state.
export function applyCodex(target: SnippetTarget, hostPort: HostPort): ApplyResult {
  const ts = Date.now();
  const ownerBefore = detectAuthJsonOwner();
  const preserve = ownerBefore === "external";
  const authBackup = backupFile(authJsonPath(), ts, { preserve });
  const tomlBackup = backupFile(configTomlPath(), ts, { preserve });

  const { authJson } = buildCcSwitchFiles(hostPort, target);
  atomicWrite(authJsonPath(), authJson);

  // config.toml: when one already exists, surgically merge only the keys we
  // manage so the user's other sections (comments, [projects], [mcp_servers],
  // model_reasoning_effort …) survive the switch. A fresh install (no file)
  // gets the rich first-run snippet with the alternatives comment.
  const existingToml = readConfigTomlIfExists();
  const tomlOut =
    existingToml == null
      ? buildCcSwitchFiles(hostPort, target).configToml
      : mergeCodexProviderToml(existingToml, buildProviderTomlPatch(hostPort, target));
  atomicWrite(configTomlPath(), tomlOut);

  pruneBackups(authJsonPath(), BACKUP_KEEP);
  pruneBackups(configTomlPath(), BACKUP_KEEP);

  return {
    backupTs: ts,
    authBackup,
    tomlBackup,
    authJsonOwnerBefore: ownerBefore,
    preserved: preserve,
  };
}

// Lightweight regex over a config.toml backup so the UI can label each
// row with "this was provider=X / model=Y". We don't parse TOML — Codex's
// schema is wide and we only care about the two well-known top-level keys.
function snifConfigToml(filePath: string | null): { model: string | null; provider: string | null } {
  if (!filePath || !existsSync(filePath)) return { model: null, provider: null };
  try {
    const text = readFileSync(filePath, "utf-8");
    const modelMatch = /^\s*model\s*=\s*"([^"\n]+)"/m.exec(text);
    const providerMatch = /^\s*model_provider\s*=\s*"([^"\n]+)"/m.exec(text);
    return { model: modelMatch?.[1] ?? null, provider: providerMatch?.[1] ?? null };
  } catch {
    return { model: null, provider: null };
  }
}

function snifAuthOwner(filePath: string | null): AuthJsonOwner {
  if (!filePath || !existsSync(filePath)) return "missing";
  try {
    const text = readFileSync(filePath, "utf-8");
    const json = JSON.parse(text) as { OPENAI_API_KEY?: unknown };
    if (json && json.OPENAI_API_KEY === "mimo2codex-local") return "mimo2codex";
    return "external";
  } catch {
    return "external";
  }
}

export interface BackupPair {
  ts: number;
  authBackup: string | null;
  tomlBackup: string | null;
  // True when at least one half of this pair is tagged .preserve. Those
  // pairs are exempt from automatic pruning; the UI shows a 🔒 badge.
  preserved: boolean;
  // Best-effort snapshot of what config.toml looked like at this ts.
  // null when no toml backup exists or the file was unreadable.
  model: string | null;
  provider: string | null;
  // Owner type inferred from the auth.json backup's content (the
  // sentinel-check that detectAuthJsonOwner uses on the live file).
  // For .preserve backups this is always "external" by construction,
  // but we recompute so half-pairs and legacy backups also get labeled.
  authBackupOwner: AuthJsonOwner;
}

// Pair backups by timestamp prefix. Half-pairs (only one of the two files
// existed before an apply) are surfaced too — restoreCodex handles them
// by deleting the file that didn't exist pre-apply, returning the disk
// to its real prior state.
export function listBackupPairs(): BackupPair[] {
  const auth = listBackups(authJsonPath());
  const toml = listBackups(configTomlPath());
  const byTs = new Map<number, { ts: number; authBackup: BackupEntry | null; tomlBackup: BackupEntry | null }>();
  for (const a of auth) {
    const existing = byTs.get(a.ts) ?? { ts: a.ts, authBackup: null, tomlBackup: null };
    existing.authBackup = a;
    byTs.set(a.ts, existing);
  }
  for (const t of toml) {
    const existing = byTs.get(t.ts) ?? { ts: t.ts, authBackup: null, tomlBackup: null };
    existing.tomlBackup = t;
    byTs.set(t.ts, existing);
  }
  const out: BackupPair[] = [];
  for (const v of byTs.values()) {
    const sniff = snifConfigToml(v.tomlBackup?.path ?? null);
    out.push({
      ts: v.ts,
      authBackup: v.authBackup?.path ?? null,
      tomlBackup: v.tomlBackup?.path ?? null,
      preserved: !!v.authBackup?.preserved || !!v.tomlBackup?.preserved,
      model: sniff.model,
      provider: sniff.provider,
      authBackupOwner: snifAuthOwner(v.authBackup?.path ?? null),
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// Restore both files to whatever state existed at the chosen ts. Symmetric:
//   - if a backup of either file exists → atomic-write it back
//   - if no backup of that file exists → it didn't exist pre-apply, so we
//     DELETE the current file (returning the disk to its real prior state)
// This handles the common "user had real OpenAI auth.json but no config.toml"
// scenario, where only auth.json was backed up. Without the delete step the
// restored auth.json would coexist with our config.toml — a mixed state that
// is exactly what the paired-backup invariant aimed to prevent.
export function restoreCodex(ts: number): void {
  const pair = listBackupPairs().find((p) => p.ts === ts);
  if (!pair) {
    throw new Error(`no backup pair with ts=${ts}`);
  }
  if (pair.authBackup) {
    const bytes = readFileSync(pair.authBackup, "utf-8");
    atomicWrite(authJsonPath(), bytes);
  } else if (existsSync(authJsonPath())) {
    assertInsideCodexDir(authJsonPath());
    rmSync(authJsonPath(), { force: true });
  }
  if (pair.tomlBackup) {
    const bytes = readFileSync(pair.tomlBackup, "utf-8");
    atomicWrite(configTomlPath(), bytes);
  } else if (existsSync(configTomlPath())) {
    assertInsideCodexDir(configTomlPath());
    rmSync(configTomlPath(), { force: true });
  }
}

// Manually drop a backup pair. Preserved pairs require `force: true` so a
// careless click in the UI doesn't toss the user's only path back to their
// real Codex config. Returns the total number of files removed (0, 1, or 2).
export function deleteBackupPair(ts: number, opts?: { force?: boolean }): number {
  const pair = listBackupPairs().find((p) => p.ts === ts);
  if (!pair) {
    throw new Error(`no backup pair with ts=${ts}`);
  }
  if (pair.preserved && !opts?.force) {
    throw new Error(
      `backup pair at ts=${ts} is preserved (captured your original Codex config); pass force=true to delete it anyway`
    );
  }
  let n = 0;
  n += deleteBackupsAt(authJsonPath(), ts);
  n += deleteBackupsAt(configTomlPath(), ts);
  return n;
}

export interface CodexState {
  codexDir: string;
  authPath: string;
  tomlPath: string;
  authJsonOwner: AuthJsonOwner;
  authJsonExists: boolean;
  configTomlExists: boolean;
  // Raw config.toml content (best-effort UI display; we don't parse TOML
  // server-side because Codex's schema is broad).
  configTomlText: string | null;
  backups: BackupPair[];
}

export function readCodexState(): CodexState {
  const auth = authJsonPath();
  const toml = configTomlPath();
  return {
    codexDir: codexDir(),
    authPath: auth,
    tomlPath: toml,
    authJsonOwner: detectAuthJsonOwner(),
    authJsonExists: existsSync(auth),
    configTomlExists: existsSync(toml),
    configTomlText: readConfigTomlIfExists(),
    backups: listBackupPairs(),
  };
}

// Re-exported for routes that only want a count without the full state read.
export { listBackups, type BackupEntry, type AuthJsonOwner };
