// HTTP entry points for the OAuth flow. Two routes:
//   GET /oauth/login/:provider     — issue state, 302 to provider authorize URL
//   GET /oauth/callback/:provider  — verify state, exchange code, create session
//
// Both run without a session cookie (the user is precisely the one whose
// session we're about to mint). The state token is stored as a single-use row
// in bootstrap_tokens with purpose='oauth_state' and a 10-minute TTL.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.js";
import { log } from "../util/log.js";
import {
  consumeBootstrapToken,
  createBootstrapToken,
  parsePayload,
} from "../db/bootstrapTokens.js";
import {
  getOAuthClientSecret,
  type OAuthProvider,
} from "../db/oauthClients.js";
import { findIdentity, linkOAuthIdentity } from "../db/oauthIdentities.js";
import { createUser, findUserById, findUserByUsername } from "../db/users.js";
import { createSession } from "../db/sessions.js";
import { loadMasterKey } from "../security/masterKey.js";
import { buildSessionCookie } from "./middleware.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForIdentity,
  synthesizeUsername,
  type ExchangeFns,
} from "./oauth.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isKnownProvider(p: string): p is OAuthProvider {
  return p === "github" || p === "gitee";
}

function send302(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function send400(res: ServerResponse, msg: string): void {
  res.statusCode = 400;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(msg);
}

// Allow tests to inject a fake fetch instead of hitting the network. Production
// flow always uses the global fetch.
export interface OAuthRouteDeps {
  fetch?: typeof fetch;
}

export async function handleOAuthRoutes(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse,
  deps: OAuthRouteDeps = {}
): Promise<boolean> {
  const url = req.url ?? "/";
  const path = url.split("?")[0];
  if (!path.startsWith("/oauth/")) return false;

  // /oauth/login/:provider — initiate flow.
  {
    const m = /^\/oauth\/login\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (m && req.method === "GET") {
      const provider = m[1];
      if (!isKnownProvider(provider)) {
        send400(res, `unknown OAuth provider: ${provider}`);
        return true;
      }
      const { key } = loadMasterKey(cfg.dataDir);
      const client = getOAuthClientSecret(provider, key);
      if (!client || !client.enabled) {
        send400(res, `OAuth provider ${provider} is not configured or not enabled`);
        return true;
      }
      const { token: state } = createBootstrapToken({
        purpose: "oauth_state",
        ttlMs: STATE_TTL_MS,
        payload: { provider },
      });
      const target = buildAuthorizeUrl(provider, {
        clientId: client.clientId,
        redirectUri: client.callbackUrl,
        state,
      });
      send302(res, target);
      return true;
    }
  }

  // /oauth/callback/:provider — complete flow.
  {
    const m = /^\/oauth\/callback\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (m && req.method === "GET") {
      const provider = m[1];
      if (!isKnownProvider(provider)) {
        send400(res, `unknown OAuth provider: ${provider}`);
        return true;
      }
      const u = new URL(url, "http://localhost");
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      if (!code || !state) {
        send400(res, "missing code or state in callback");
        return true;
      }
      const consumed = consumeBootstrapToken(state, "oauth_state");
      if (!consumed) {
        send400(res, "invalid or expired OAuth state");
        return true;
      }
      const payload = parsePayload(consumed) as { provider?: string } | null;
      if (payload?.provider !== provider) {
        send400(res, "state/provider mismatch");
        return true;
      }
      const { key } = loadMasterKey(cfg.dataDir);
      const client = getOAuthClientSecret(provider, key);
      if (!client || !client.enabled) {
        send400(res, `OAuth provider ${provider} is no longer enabled`);
        return true;
      }
      let identity;
      try {
        identity = await exchangeCodeForIdentity(
          provider,
          {
            code,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            redirectUri: client.callbackUrl,
          },
          deps as ExchangeFns
        );
      } catch (err) {
        log.error("oauth exchange failed", { provider, error: (err as Error).message });
        send400(res, `OAuth exchange failed: ${(err as Error).message}`);
        return true;
      }

      // Find or create the local account.
      const linked = findIdentity(provider, identity.providerUserId);
      let userId: number;
      if (linked) {
        userId = linked.user_id;
        linkOAuthIdentity({
          userId,
          provider,
          providerUserId: identity.providerUserId,
          providerUsername: identity.providerUsername,
          avatarUrl: identity.avatarUrl,
        });
      } else {
        const username = pickUnusedUsername(synthesizeUsername(provider, identity));
        const user = createUser({
          username,
          displayName: identity.displayName ?? identity.providerUsername ?? username,
          passwordHash: null,
          isAdmin: false,
        });
        linkOAuthIdentity({
          userId: user.id,
          provider,
          providerUserId: identity.providerUserId,
          providerUsername: identity.providerUsername,
          avatarUrl: identity.avatarUrl,
        });
        userId = user.id;
        log.info(`oauth: created local user "${username}" linked to ${provider}:${identity.providerUserId}`);
      }

      const user = findUserById(userId);
      if (!user || user.status !== "active") {
        send400(res, "linked account is disabled");
        return true;
      }
      const { token } = createSession({
        userId,
        userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
        ip: req.socket?.remoteAddress ?? null,
        ttlMs: SESSION_TTL_MS,
      });
      res.statusCode = 302;
      res.setHeader(
        "Set-Cookie",
        buildSessionCookie(token, { ttlMs: SESSION_TTL_MS, secure: cfg.cookieSecure })
      );
      res.setHeader("Location", "/admin/");
      res.end();
      return true;
    }
  }

  return false;
}

function pickUnusedUsername(base: string): string {
  if (!findUserByUsername(base)) return base;
  // OAuth-provided handle collided with an existing local account — append
  // a numeric suffix so the auto-created row doesn't fail the UNIQUE
  // constraint. The user can rename later from their Account page.
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`;
    if (!findUserByUsername(candidate)) return candidate;
  }
  return `${base}_${Math.floor(Math.random() * 1_000_000)}`;
}
