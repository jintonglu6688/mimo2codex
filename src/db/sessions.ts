// Server-side session records. Session token is a random opaque string that
// only ever leaves on the Set-Cookie header during login/bootstrap; we store
// only sha256(token) so a DB leak doesn't grant access.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./index.js";
import { findUserById, type UserRow } from "./users.js";

export interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
  ip: string | null;
}

export interface NewSession {
  userId: number;
  ttlMs?: number;
  userAgent?: string | null;
  ip?: string | null;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, sliding

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSession(opts: NewSession): { token: string; row: SessionRow } {
  const now = Date.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const token = "m2cs_" + randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const info = getDb()
    .prepare(
      `INSERT INTO user_sessions
        (user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(opts.userId, tokenHash, now, now + ttl, now, opts.userAgent ?? null, opts.ip ?? null);
  const row = getDb()
    .prepare("SELECT * FROM user_sessions WHERE id = ?")
    .get(info.lastInsertRowid) as SessionRow;
  return { token, row };
}

export function findSessionByToken(
  token: string
): { session: SessionRow; user: UserRow } | null {
  if (!token) return null;
  const hash = hashToken(token);
  const session = getDb()
    .prepare("SELECT * FROM user_sessions WHERE token_hash = ?")
    .get(hash) as SessionRow | undefined;
  if (!session) return null;
  // Timing-equal compare to avoid token-existence side channel via SQL probe.
  const a = Buffer.from(session.token_hash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (session.expires_at <= Date.now()) {
    deleteSession(session.id);
    return null;
  }
  const user = findUserById(session.user_id);
  if (!user || user.status !== "active") {
    deleteSession(session.id);
    return null;
  }
  return { session, user };
}

export function touchSession(id: number, ttlMs: number = DEFAULT_TTL_MS): void {
  const now = Date.now();
  getDb()
    .prepare("UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
    .run(now, now + ttlMs, id);
}

export function deleteSession(id: number): boolean {
  const info = getDb().prepare("DELETE FROM user_sessions WHERE id = ?").run(id);
  return info.changes > 0;
}

export function deleteSessionByToken(token: string): boolean {
  return getDb().prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(hashToken(token))
    .changes > 0;
}

export function pruneExpiredSessions(): number {
  const info = getDb()
    .prepare("DELETE FROM user_sessions WHERE expires_at <= ?")
    .run(Date.now());
  return info.changes;
}
