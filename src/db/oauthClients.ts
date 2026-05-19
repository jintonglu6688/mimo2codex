// OAuth client credentials, one row per provider (gitee / github). The
// client_secret is sealed with the deployment's master key — admin UI can
// upsert it but never reads it back in plaintext to the browser; only the
// server-side OAuth code-exchange step decrypts on demand.

import { getDb } from "./index.js";
import { decryptString, encryptString } from "../security/encryption.js";

export type OAuthProvider = "gitee" | "github";

export interface OAuthClientRow {
  provider: OAuthProvider;
  client_id: string;
  client_secret_ciphertext: string;
  client_secret_nonce: string;
  client_secret_auth_tag: string;
  callback_url: string;
  enabled: number;
  updated_at: number;
}

export interface OAuthClientSummary {
  provider: OAuthProvider;
  client_id: string;
  callback_url: string;
  enabled: boolean;
  updated_at: number;
  has_secret: boolean;
}

export interface UpsertOAuthClient {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string | null; // null = leave existing secret untouched
  callbackUrl: string;
  enabled: boolean;
}

export function upsertOAuthClient(input: UpsertOAuthClient, masterKey: Buffer): void {
  const existing = getOAuthClientRow(input.provider);
  let ct: string;
  let nonce: string;
  let tag: string;
  if (input.clientSecret) {
    const sealed = encryptString(input.clientSecret, masterKey);
    ct = sealed.ciphertext;
    nonce = sealed.nonce;
    tag = sealed.authTag;
  } else if (existing) {
    ct = existing.client_secret_ciphertext;
    nonce = existing.client_secret_nonce;
    tag = existing.client_secret_auth_tag;
  } else {
    throw new Error("client_secret is required when creating a new OAuth client");
  }
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO oauth_clients
        (provider, client_id, client_secret_ciphertext, client_secret_nonce, client_secret_auth_tag, callback_url, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         client_id = excluded.client_id,
         client_secret_ciphertext = excluded.client_secret_ciphertext,
         client_secret_nonce = excluded.client_secret_nonce,
         client_secret_auth_tag = excluded.client_secret_auth_tag,
         callback_url = excluded.callback_url,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    )
    .run(input.provider, input.clientId, ct, nonce, tag, input.callbackUrl, input.enabled ? 1 : 0, now);
}

export function getOAuthClientRow(provider: OAuthProvider): OAuthClientRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM oauth_clients WHERE provider = ?")
      .get(provider) as OAuthClientRow | undefined) ?? null
  );
}

export function getOAuthClientSecret(
  provider: OAuthProvider,
  masterKey: Buffer
): { clientId: string; clientSecret: string; callbackUrl: string; enabled: boolean } | null {
  const row = getOAuthClientRow(provider);
  if (!row) return null;
  const secret = decryptString(
    {
      ciphertext: row.client_secret_ciphertext,
      nonce: row.client_secret_nonce,
      authTag: row.client_secret_auth_tag,
    },
    masterKey
  );
  return {
    clientId: row.client_id,
    clientSecret: secret,
    callbackUrl: row.callback_url,
    enabled: row.enabled === 1,
  };
}

export function listOAuthClients(): OAuthClientSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM oauth_clients ORDER BY provider")
    .all() as OAuthClientRow[];
  return rows.map((r) => ({
    provider: r.provider,
    client_id: r.client_id,
    callback_url: r.callback_url,
    enabled: r.enabled === 1,
    updated_at: r.updated_at,
    has_secret: !!r.client_secret_ciphertext,
  }));
}

export function deleteOAuthClient(provider: OAuthProvider): boolean {
  const info = getDb().prepare("DELETE FROM oauth_clients WHERE provider = ?").run(provider);
  return info.changes > 0;
}
