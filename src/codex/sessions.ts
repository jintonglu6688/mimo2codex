import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { codexDir, assertInsideCodexDir } from "./paths.js";
import { backupsDir } from "./files.js";

// Codex Desktop keeps its session list in ~/.codex/state_<N>.sqlite — table
// `threads`, one row per session, carrying the `model_provider` it filters by.
// That's why switching providers in mimo2codex hides sessions from each other.
// We read this read-only to browse, and (carefully) write `model_provider` to
// migrate a session to a different provider so Codex surfaces it there.
//
// This touches Codex's private, undocumented state. The schema name is
// version-stamped (state_5 → state_6 …) and columns can change between Codex
// releases, so every entry point degrades gracefully when the shape isn't what
// we expect, and migration always backs up first and refuses to run while
// Codex holds the DB lock.

export interface CodexSession {
  id: string;
  provider: string;
  cwd: string;
  title: string;
  firstUserMessage: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  rolloutPath: string;
  tokensUsed: number;
}

export interface CodexSessionsResult {
  // Absolute path of the state DB we read, or null when none was found.
  dbPath: string | null;
  // True when the `threads` table was present and read successfully.
  available: boolean;
  sessions: CodexSession[];
  // Distinct provider values seen across sessions — handy for the UI's
  // "migrate to" picker even for providers not currently configured.
  providers: string[];
}

// Find the newest state_<N>.sqlite in the codex dir (highest N wins, so we
// follow Codex across schema bumps). Returns null when none exist.
export function findStateDb(): string | null {
  const dir = codexDir();
  if (!existsSync(dir)) return null;
  let best: { n: number; name: string } | null = null;
  for (const name of readdirSync(dir)) {
    const m = /^state_(\d+)\.sqlite$/.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (!best || n > best.n) best = { n, name };
  }
  return best ? path.join(dir, best.name) : null;
}

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function listCodexSessions(): CodexSessionsResult {
  const dbPath = findStateDb();
  if (!dbPath) return { dbPath: null, available: false, sessions: [], providers: [] };
  let db: Database.Database | null = null;
  try {
    db = openReadonly(dbPath);
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
      .get();
    if (!hasTable) return { dbPath, available: false, sessions: [], providers: [] };
    const rows = db
      .prepare(
        `SELECT id, model_provider, cwd, title, first_user_message,
                created_at, updated_at, archived, rollout_path, tokens_used
         FROM threads ORDER BY updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const sessions: CodexSession[] = rows.map((r) => ({
      id: String(r.id),
      provider: String(r.model_provider ?? ""),
      cwd: String(r.cwd ?? ""),
      title: String(r.title ?? ""),
      firstUserMessage: String(r.first_user_message ?? ""),
      createdAt: Number(r.created_at ?? 0),
      updatedAt: Number(r.updated_at ?? 0),
      archived: Number(r.archived ?? 0) === 1,
      rolloutPath: String(r.rollout_path ?? ""),
      tokensUsed: Number(r.tokens_used ?? 0),
    }));
    const providers = [...new Set(sessions.map((s) => s.provider).filter(Boolean))].sort();
    return { dbPath, available: true, sessions, providers };
  } catch {
    return { dbPath, available: false, sessions: [], providers: [] };
  } finally {
    db?.close();
  }
}

export class CodexBusyError extends Error {
  constructor() {
    super("codex_running");
    this.name = "CodexBusyError";
  }
}

// Rewrite the `model_provider` in a rollout file's first-line session_meta so
// the on-disk session record stays consistent with the threads row. Best
// effort: silently skips when the file is missing or not the expected shape.
function rewriteRolloutProvider(rolloutPath: string, toProvider: string): void {
  if (!rolloutPath || !existsSync(rolloutPath)) return;
  try {
    assertInsideCodexDir(rolloutPath);
  } catch {
    return; // refuse to touch anything outside ~/.codex/
  }
  const text = readFileSync(rolloutPath, "utf-8");
  const nl = text.indexOf("\n");
  const firstLine = nl === -1 ? text : text.slice(0, nl);
  let head: { type?: string; payload?: Record<string, unknown> };
  try {
    head = JSON.parse(firstLine);
  } catch {
    return;
  }
  if (head?.type !== "session_meta" || !head.payload) return;
  head.payload.model_provider = toProvider;
  const rest = nl === -1 ? "" : text.slice(nl);
  writeFileSync(rolloutPath, JSON.stringify(head) + rest, "utf-8");
}

export interface MigrateResult {
  id: string;
  fromProvider: string;
  toProvider: string;
  backupDir: string;
}

// Move a session to a different provider by rewriting threads.model_provider
// (and the rollout's session_meta to match). Backs up the whole state DB +
// rollout first, and refuses to run while Codex holds the DB lock.
export function migrateSessionProvider(id: string, toProvider: string): MigrateResult {
  if (!/^[A-Za-z0-9._-]+$/.test(toProvider)) {
    throw new Error(`invalid target provider "${toProvider}"`);
  }
  const dbPath = findStateDb();
  if (!dbPath) throw new Error("no Codex state database found");

  // Snapshot current row (read-only) for the from-provider + rollout path.
  const before = listCodexSessions().sessions.find((s) => s.id === id);
  if (!before) throw new Error(`session ${id} not found`);

  // Back up the DB triad + rollout before mutating anything.
  const ts = Date.now();
  const backupDir = path.join(backupsDir(), "sessions", String(ts));
  mkdirSync(backupDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) copyFileSync(f, path.join(backupDir, path.basename(f)));
  }
  if (before.rolloutPath && existsSync(before.rolloutPath)) {
    copyFileSync(before.rolloutPath, path.join(backupDir, path.basename(before.rolloutPath)));
  }

  // Open read-write with a tiny busy timeout; BEGIN IMMEDIATE fails fast with
  // SQLITE_BUSY when Codex Desktop has the DB open — our signal to abort.
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 300");
    const tx = db.transaction(() => {
      db.prepare("UPDATE threads SET model_provider = ? WHERE id = ?").run(toProvider, id);
    });
    try {
      tx.immediate();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT") {
        throw new CodexBusyError();
      }
      throw err;
    }
  } finally {
    db.close();
  }

  rewriteRolloutProvider(before.rolloutPath, toProvider);

  return { id, fromProvider: before.provider, toProvider, backupDir };
}
