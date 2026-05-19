// Codex client config version history. Each apply / restore writes a row;
// user_id is nullable so local-mode (single-user, no auth) gets a single
// shared timeline keyed by NULL. Retention policy keeps the earliest "initial"
// snapshot forever (so the user can roll back to their pre-mimo2codex setup)
// plus the most recent 10 entries of any other kind.

import { getDb } from "./index.js";

export type CodexHistoryKind = "initial" | "apply" | "restore";

export interface CodexHistoryRow {
  id: number;
  user_id: number | null;
  ts: number;
  kind: CodexHistoryKind;
  provider_id: string | null;
  model_id: string | null;
  auth_json: string;
  config_toml: string;
  note: string | null;
}

const RECENT_KEEP = 10;

export interface AppendHistory {
  userId: number | null;
  kind: CodexHistoryKind;
  providerId?: string | null;
  modelId?: string | null;
  authJson: string;
  configToml: string;
  note?: string | null;
}

export function appendCodexHistory(entry: AppendHistory): CodexHistoryRow {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO codex_config_history
        (user_id, ts, kind, provider_id, model_id, auth_json, config_toml, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.userId,
      now,
      entry.kind,
      entry.providerId ?? null,
      entry.modelId ?? null,
      entry.authJson,
      entry.configToml,
      entry.note ?? null
    );
  pruneCodexHistory(entry.userId);
  return getCodexHistoryById(Number(info.lastInsertRowid))!;
}

export function hasInitialHistory(userId: number | null): boolean {
  const row = (
    userId == null
      ? getDb()
          .prepare(
            "SELECT 1 AS x FROM codex_config_history WHERE user_id IS NULL AND kind = 'initial' LIMIT 1"
          )
          .get()
      : getDb()
          .prepare(
            "SELECT 1 AS x FROM codex_config_history WHERE user_id = ? AND kind = 'initial' LIMIT 1"
          )
          .get(userId)
  ) as { x: number } | undefined;
  return !!row;
}

export function listCodexHistory(userId: number | null, limit = 50): CodexHistoryRow[] {
  return (
    userId == null
      ? getDb()
          .prepare(
            "SELECT * FROM codex_config_history WHERE user_id IS NULL ORDER BY ts DESC, id DESC LIMIT ?"
          )
          .all(limit)
      : getDb()
          .prepare(
            "SELECT * FROM codex_config_history WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?"
          )
          .all(userId, limit)
  ) as CodexHistoryRow[];
}

export function getCodexHistoryById(id: number): CodexHistoryRow | null {
  return (getDb()
    .prepare("SELECT * FROM codex_config_history WHERE id = ?")
    .get(id) as CodexHistoryRow | undefined) ?? null;
}

export function deleteCodexHistory(id: number, userId: number | null): boolean {
  const info =
    userId == null
      ? getDb()
          .prepare(
            "DELETE FROM codex_config_history WHERE id = ? AND user_id IS NULL AND kind != 'initial'"
          )
          .run(id)
      : getDb()
          .prepare(
            "DELETE FROM codex_config_history WHERE id = ? AND user_id = ? AND kind != 'initial'"
          )
          .run(id, userId);
  return info.changes > 0;
}

// Keep the earliest 'initial' row (if any) and the most recent RECENT_KEEP
// non-initial rows. Anything else gets pruned.
export function pruneCodexHistory(userId: number | null): number {
  const params = userId == null ? [] : [userId];
  const userClause = userId == null ? "user_id IS NULL" : "user_id = ?";
  const info = getDb()
    .prepare(
      `DELETE FROM codex_config_history
        WHERE ${userClause}
          AND kind != 'initial'
          AND id NOT IN (
            SELECT id FROM codex_config_history
             WHERE ${userClause} AND kind != 'initial'
             ORDER BY ts DESC, id DESC
             LIMIT ${RECENT_KEEP}
          )`
    )
    .run(...params, ...params);
  return info.changes;
}
