// Provider-agnostic OAuth 2.0 code-grant flow for Gitee + GitHub. We don't
// need a generic OIDC library — both providers follow the same shape:
//   1. redirect to <authorize_url>?client_id=...&redirect_uri=...&state=...&scope=...
//   2. provider hands back ?code=...&state=...
//   3. POST <token_url> with code → access_token
//   4. GET <user_url> with the bearer token → identity payload
//
// The provider-specific bits (URLs, scopes, parsing the identity payload)
// live in PROVIDERS below; everything else is shared.

import type { OAuthProvider } from "../db/oauthClients.js";

export interface OAuthIdentity {
  providerUserId: string;
  providerUsername: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface OAuthProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  // Body the token exchange POST expects. Gitee wants URLSearchParams,
  // GitHub accepts JSON with Accept: application/json.
  buildTokenRequest: (params: TokenExchangeParams) => { body: string; headers: Record<string, string> };
  // Parse the access token out of the token response body.
  extractAccessToken: (parsed: unknown) => string | null;
  // Translate the provider's /user payload into our common shape.
  parseUser: (parsed: unknown) => OAuthIdentity;
}

interface TokenExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const PROVIDERS: Record<OAuthProvider, OAuthProviderSpec> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "read:user user:email",
    buildTokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }),
    extractAccessToken: (parsed) =>
      (parsed as Record<string, unknown>)?.access_token as string | undefined ?? null,
    parseUser: (parsed) => {
      const o = parsed as Record<string, unknown>;
      return {
        providerUserId: String(o.id ?? ""),
        providerUsername: typeof o.login === "string" ? o.login : null,
        displayName: typeof o.name === "string" ? o.name : null,
        avatarUrl: typeof o.avatar_url === "string" ? o.avatar_url : null,
        email: typeof o.email === "string" ? o.email : null,
      };
    },
  },
  gitee: {
    authorizeUrl: "https://gitee.com/oauth/authorize",
    tokenUrl: "https://gitee.com/oauth/token",
    userUrl: "https://gitee.com/api/v5/user",
    scope: "user_info",
    buildTokenRequest: ({ code, clientId, clientSecret, redirectUri }) => {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });
      return {
        body: body.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      };
    },
    extractAccessToken: (parsed) =>
      (parsed as Record<string, unknown>)?.access_token as string | undefined ?? null,
    parseUser: (parsed) => {
      const o = parsed as Record<string, unknown>;
      return {
        providerUserId: String(o.id ?? ""),
        providerUsername: typeof o.login === "string" ? o.login : null,
        displayName: typeof o.name === "string" ? o.name : null,
        avatarUrl: typeof o.avatar_url === "string" ? o.avatar_url : null,
        email: typeof o.email === "string" ? o.email : null,
      };
    },
  },
};

export function getProviderSpec(provider: OAuthProvider): OAuthProviderSpec {
  return PROVIDERS[provider];
}

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  opts: { clientId: string; redirectUri: string; state: string }
): string {
  const spec = getProviderSpec(provider);
  const u = new URL(spec.authorizeUrl);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("scope", spec.scope);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

// Exchange the auth code for an access token and fetch the identity. We
// intentionally use fetch() — the same dep we already use elsewhere — so the
// only test surface is the network IO.
export interface ExchangeFns {
  fetch?: typeof fetch;
}

export async function exchangeCodeForIdentity(
  provider: OAuthProvider,
  opts: TokenExchangeParams,
  fns: ExchangeFns = {}
): Promise<OAuthIdentity> {
  const f = fns.fetch ?? fetch;
  const spec = getProviderSpec(provider);
  const tokenReq = spec.buildTokenRequest(opts);
  const tokenRes = await f(spec.tokenUrl, {
    method: "POST",
    headers: tokenReq.headers,
    body: tokenReq.body,
  });
  if (!tokenRes.ok) {
    throw new Error(`token exchange failed: ${tokenRes.status} ${await safeText(tokenRes)}`);
  }
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const accessToken = spec.extractAccessToken(tokenJson);
  if (!accessToken) {
    throw new Error(
      `token exchange returned no access_token (provider=${provider}, payload=${JSON.stringify(tokenJson)})`
    );
  }
  const userRes = await f(spec.userUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "mimo2codex",
    },
  });
  if (!userRes.ok) {
    throw new Error(`user info fetch failed: ${userRes.status} ${await safeText(userRes)}`);
  }
  const userJson = await userRes.json().catch(() => ({}));
  const identity = spec.parseUser(userJson);
  if (!identity.providerUserId) {
    throw new Error(`provider returned identity with no id (provider=${provider})`);
  }
  return identity;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<unreadable>";
  }
}

// Synthesize a deterministic local username for an OAuth-only account. The
// user can rename it later from their Account page. Keeping it predictable
// makes it easy to spot accounts that haven't completed first-login renaming.
export function synthesizeUsername(provider: OAuthProvider, identity: OAuthIdentity): string {
  if (identity.providerUsername) {
    return `${provider}_${identity.providerUsername}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }
  return `${provider}_${identity.providerUserId}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}
