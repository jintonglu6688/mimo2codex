// Single-use, time-limited tokens. Reused for three purposes via the
// `purpose` column:
//   - bootstrap: first-admin registration after a fresh deploy
//   - invite:    admin-issued invitation links for new users
//   - oauth_state: CSRF state on the OAuth round-trip
// `payload` carries purpose-specific JSON (invited username, oauth provider+next, ...).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./index.js";

export type TokenPurpose = "bootstrap" | "invite" | "oauth_state";

export interface BootstrapTokenRow {
  id: number;
  token_hash: string;
  purpose: TokenPurpose;
  payload: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

const PREFIX: Record<TokenPurpose, string> = {
  bootstrap: "m2cb_",
  invite: "m2ci_",
  oauth_state: "m2co_",
};

function hash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CreateTokenInput {
  purpose: TokenPurpose;
  ttlMs: number;
  payload?: Record<string, unknown> | null;
}

export function createBootstrapToken(input: CreateTokenInput): { token: string; row: BootstrapTokenRow } {
  const token = PREFIX[input.purpose] + randomBytes(32).toString("hex");
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO bootstrap_tokens (token_hash, purpose, payload, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .run(
      hash(token),
      input.purpose,
      input.payload ? JSON.stringify(input.payload) : null,
      now,
      now + input.ttlMs
    );
  const row = getDb()
    .prepare("SELECT * FROM bootstrap_tokens WHERE id = ?")
    .get(info.lastInsertRowid) as BootstrapTokenRow;
  return { token, row };
}

export function peekBootstrapToken(token: string, purpose: TokenPurpose): BootstrapTokenRow | null {
  if (!token || !token.startsWith(PREFIX[purpose])) return null;
  const tokenHash = hash(token);
  const row = getDb()
    .prepare("SELECT * FROM bootstrap_tokens WHERE token_hash = ?")
    .get(tokenHash) as BootstrapTokenRow | undefined;
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  const a = Buffer.from(row.token_hash, "hex");
  const b = Buffer.from(tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (row.used_at != null) return null;
  if (row.expires_at <= Date.now()) return null;
  return row;
}

export function consumeBootstrapToken(
  token: string,
  purpose: TokenPurpose
): BootstrapTokenRow | null {
  const row = peekBootstrapToken(token, purpose);
  if (!row) return null;
  const info = getDb()
    .prepare(
      "UPDATE bootstrap_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL"
    )
    .run(Date.now(), row.id);
  if (info.changes === 0) return null;
  return { ...row, used_at: Date.now() };
}

export function findPendingByPurpose(purpose: TokenPurpose): BootstrapTokenRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM bootstrap_tokens WHERE purpose = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC"
    )
    .all(purpose, Date.now()) as BootstrapTokenRow[];
}

export function pruneExpiredBootstrapTokens(): number {
  const info = getDb()
    .prepare("DELETE FROM bootstrap_tokens WHERE expires_at <= ? OR used_at IS NOT NULL")
    .run(Date.now());
  return info.changes;
}

export function parsePayload(row: BootstrapTokenRow): Record<string, unknown> | null {
  if (!row.payload) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}
