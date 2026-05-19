// OAuth identity links. One (user, provider) pair per row; a single local user
// can link both Gitee and GitHub if they want, and a single OAuth identity
// always maps to exactly one local user.

import { getDb } from "./index.js";
import type { OAuthProvider } from "./oauthClients.js";

export interface OAuthIdentityRow {
  id: number;
  user_id: number;
  provider: OAuthProvider;
  provider_user_id: string;
  provider_username: string | null;
  avatar_url: string | null;
  linked_at: number;
}

export interface LinkIdentity {
  userId: number;
  provider: OAuthProvider;
  providerUserId: string;
  providerUsername?: string | null;
  avatarUrl?: string | null;
}

export function linkOAuthIdentity(input: LinkIdentity): OAuthIdentityRow {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO user_oauth_identities
        (user_id, provider, provider_user_id, provider_username, avatar_url, linked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET
         user_id = excluded.user_id,
         provider_username = excluded.provider_username,
         avatar_url = excluded.avatar_url,
         linked_at = excluded.linked_at`
    )
    .run(
      input.userId,
      input.provider,
      input.providerUserId,
      input.providerUsername ?? null,
      input.avatarUrl ?? null,
      now
    );
  return findIdentity(input.provider, input.providerUserId)!;
}

export function findIdentity(
  provider: OAuthProvider,
  providerUserId: string
): OAuthIdentityRow | null {
  return (
    (getDb()
      .prepare(
        "SELECT * FROM user_oauth_identities WHERE provider = ? AND provider_user_id = ?"
      )
      .get(provider, providerUserId) as OAuthIdentityRow | undefined) ?? null
  );
}

export function listIdentitiesForUser(userId: number): OAuthIdentityRow[] {
  return getDb()
    .prepare("SELECT * FROM user_oauth_identities WHERE user_id = ? ORDER BY provider")
    .all(userId) as OAuthIdentityRow[];
}

export function unlinkIdentity(userId: number, provider: OAuthProvider): boolean {
  const info = getDb()
    .prepare("DELETE FROM user_oauth_identities WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
  return info.changes > 0;
}
