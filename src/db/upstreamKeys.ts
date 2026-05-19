// BYOK upstream API keys, one per (user, provider). Stored as AES-256-GCM
// ciphertext + nonce + auth tag, sealed with the deployment's master key.
// Plaintext is never persisted and never returned by list endpoints.

import { getDb } from "./index.js";
import { decryptString, encryptString } from "../security/encryption.js";

export interface UpstreamKeyRow {
  id: number;
  user_id: number;
  provider_id: string;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  created_at: number;
  updated_at: number;
}

export interface UpstreamKeySummary {
  provider_id: string;
  created_at: number;
  updated_at: number;
}

export function setUpstreamKey(
  userId: number,
  providerId: string,
  plain: string,
  masterKey: Buffer
): void {
  const sealed = encryptString(plain, masterKey);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO user_upstream_keys
        (user_id, provider_id, ciphertext, nonce, auth_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce      = excluded.nonce,
         auth_tag   = excluded.auth_tag,
         updated_at = excluded.updated_at`
    )
    .run(userId, providerId, sealed.ciphertext, sealed.nonce, sealed.authTag, now, now);
}

export function getUpstreamKey(
  userId: number,
  providerId: string,
  masterKey: Buffer
): string | null {
  const row = getDb()
    .prepare(
      "SELECT ciphertext, nonce, auth_tag FROM user_upstream_keys WHERE user_id = ? AND provider_id = ?"
    )
    .get(userId, providerId) as
    | { ciphertext: string; nonce: string; auth_tag: string }
    | undefined;
  if (!row) return null;
  try {
    return decryptString(
      { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag },
      masterKey
    );
  } catch {
    // Master key rotated / file lost; surface as "no BYOK" so the caller falls
    // back to the shared provider key rather than 500ing the request.
    return null;
  }
}

export function listUpstreamKeys(userId: number): UpstreamKeySummary[] {
  return getDb()
    .prepare(
      "SELECT provider_id, created_at, updated_at FROM user_upstream_keys WHERE user_id = ? ORDER BY provider_id"
    )
    .all(userId) as UpstreamKeySummary[];
}

export function deleteUpstreamKey(userId: number, providerId: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM user_upstream_keys WHERE user_id = ? AND provider_id = ?")
    .run(userId, providerId);
  return info.changes > 0;
}
