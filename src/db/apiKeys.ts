// Per-user bearer tokens. Plaintext token is returned exactly once at creation
// (the UI must surface it to the user immediately). The DB stores sha256(token)
// for lookup + a short prefix for display ("m2c_abcd…").

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./index.js";
import { findUserById, type UserRow } from "./users.js";

export interface ApiKeyRow {
  id: number;
  user_id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const PREFIX = "m2c_";

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createApiKey(userId: number, name: string): { token: string; row: ApiKeyRow } {
  const token = PREFIX + randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  const prefix = token.slice(0, 12); // "m2c_xxxxxxxx" — 8 hex chars surfaced
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO user_api_keys (user_id, name, key_prefix, key_hash, created_at, last_used_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(userId, name, prefix, hash, now);
  const row = getDb()
    .prepare("SELECT * FROM user_api_keys WHERE id = ?")
    .get(info.lastInsertRowid) as ApiKeyRow;
  return { token, row };
}

export function findApiKeyByToken(token: string): { apiKey: ApiKeyRow; user: UserRow } | null {
  if (!token || !token.startsWith(PREFIX)) return null;
  const hash = tokenHash(token);
  const row = getDb()
    .prepare("SELECT * FROM user_api_keys WHERE key_hash = ?")
    .get(hash) as ApiKeyRow | undefined;
  if (!row) return null;
  if (row.revoked_at != null) return null;
  const a = Buffer.from(row.key_hash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const user = findUserById(row.user_id);
  if (!user || user.status !== "active") return null;
  return { apiKey: row, user };
}

export function listApiKeys(userId: number): ApiKeyRow[] {
  return getDb()
    .prepare("SELECT * FROM user_api_keys WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as ApiKeyRow[];
}

export function revokeApiKey(userId: number, id: number): boolean {
  const info = getDb()
    .prepare(
      "UPDATE user_api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    )
    .run(Date.now(), id, userId);
  return info.changes > 0;
}

export function touchApiKey(id: number): void {
  getDb().prepare("UPDATE user_api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
}
