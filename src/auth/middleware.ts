// Authentication guard for the HTTP layer. In authMode='off' this is a no-op
// (req.user stays null) — local single-user deployments keep their current
// zero-friction UX. In authMode='on' the guard enforces:
//
//   * /admin/api/*: session cookie required, except for the whitelist below
//   * /admin/* (HTML/asset GETs): served regardless — the SPA handles redirect
//     to /admin/login on its own once it sees `me: null`
//   * /v1/*: bearer token required (Authorization: Bearer m2c_...)
//
// The guard runs BEFORE route dispatch in server.ts. It returns `null` to
// signal "request handled (rejected/redirected) — do not continue" or an
// `AuthContext` describing the resolved user. The AuthContext is then handed
// to downstream handlers so they can scope queries (BYOK lookup, history
// timeline, admin-only routes, …).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.js";
import { findApiKeyByToken, touchApiKey } from "../db/apiKeys.js";
import {
  findSessionByToken,
  touchSession,
  type SessionRow,
} from "../db/sessions.js";
import type { UserRow } from "../db/users.js";

export interface AuthContext {
  // The resolved user. NULL in local mode (authMode='off') where there is
  // no notion of a user; downstream code must accept null as "single-user
  // fallback" (BYOK skipped, history written with user_id=NULL, etc.).
  user: UserRow | null;
  // Source of authentication. "none" only when authMode=off.
  via: "none" | "session" | "api_key";
  // Session row (only when via=session) — handlers like /admin/api/auth/logout
  // need this to revoke the right row.
  session?: SessionRow;
}

// Paths that are reachable without authentication even in authMode='on'.
// Bootstrap / login are bootstrappy by definition; health is a probe; the
// OAuth-providers list is needed before login so the page can render the
// right set of buttons.
const PUBLIC_API_PREFIXES = [
  "/admin/api/health",
  "/admin/api/auth/login",
  "/admin/api/auth/me", // returns 200 {user:null} when unauthenticated
  "/admin/api/auth/oauth-providers",
  "/admin/api/auth/register", // self-registration: open when policy allows
  "/admin/api/bootstrap",
];

const PUBLIC_OAUTH_PATHS = ["/oauth/login/", "/oauth/callback/"];

export interface GuardResult {
  // When `handled` is true, the guard has already written a response — the
  // outer dispatcher must stop. Otherwise the request continues to the
  // matching route handler with `ctx` populated.
  handled: boolean;
  ctx: AuthContext;
}

export function authGuard(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse
): GuardResult {
  // Local-mode fast path: no guard, no DB lookups, no cookie reads.
  if (cfg.authMode === "off") {
    return { handled: false, ctx: { user: null, via: "none" } };
  }

  const url = req.url ?? "/";
  const path = url.split("?")[0];

  // OAuth callbacks live at /oauth/* (not /admin/) — they must be reachable
  // before the user has a session.
  if (PUBLIC_OAUTH_PATHS.some((p) => path.startsWith(p))) {
    return { handled: false, ctx: { user: null, via: "none" } };
  }

  // /v1/* — bearer token only. No session-cookie fallback (Codex never sets
  // cookies) and no anonymous access.
  if (path.startsWith("/v1/")) {
    const token = extractBearerToken(req);
    if (!token) {
      respond401(res, "missing_bearer", "Authorization: Bearer <token> required");
      return { handled: true, ctx: { user: null, via: "none" } };
    }
    const found = findApiKeyByToken(token);
    if (!found) {
      respond401(res, "invalid_bearer", "API key is invalid or revoked");
      return { handled: true, ctx: { user: null, via: "none" } };
    }
    touchApiKey(found.apiKey.id);
    return { handled: false, ctx: { user: found.user, via: "api_key" } };
  }

  // /admin/api/* — session cookie. /admin/api/auth/me deliberately falls
  // through so the SPA can probe login state without 401-spam in the console.
  if (path.startsWith("/admin/api/")) {
    const skipAuth = PUBLIC_API_PREFIXES.some((p) =>
      p.endsWith("/") ? path.startsWith(p) : path === p
    );
    const token = readSessionCookie(req);
    const found = token ? findSessionByToken(token) : null;
    if (!found) {
      if (skipAuth) {
        return { handled: false, ctx: { user: null, via: "none" } };
      }
      respond401(res, "no_session", "session required");
      return { handled: true, ctx: { user: null, via: "none" } };
    }
    touchSession(found.session.id);
    return {
      handled: false,
      ctx: { user: found.user, via: "session", session: found.session },
    };
  }

  // /admin/* (HTML / asset GETs): always served. The SPA renders login on
  // its own when /admin/api/auth/me returns user=null. Anything that the
  // SPA gates behind a logged-in view (e.g. settings page) makes its own
  // API calls — those are guarded above.
  if (path === "/admin" || path.startsWith("/admin/")) {
    // Best-effort session resolution so handlers that want to know who's
    // browsing can; failure here does not block the response.
    const token = readSessionCookie(req);
    const found = token ? findSessionByToken(token) : null;
    if (found) {
      touchSession(found.session.id);
      return {
        handled: false,
        ctx: { user: found.user, via: "session", session: found.session },
      };
    }
    return { handled: false, ctx: { user: null, via: "none" } };
  }

  // Other paths (e.g. /healthz) — not gated.
  return { handled: false, ctx: { user: null, via: "none" } };
}

export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export const SESSION_COOKIE_NAME = "m2c_session";

export function readSessionCookie(req: IncomingMessage): string | null {
  const raw = req.headers["cookie"];
  if (!raw || typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export interface CookieOpts {
  ttlMs: number;
  secure: boolean;
}

export function buildSessionCookie(token: string, opts: CookieOpts): string {
  const maxAge = Math.floor(opts.ttlMs / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function respond401(res: ServerResponse, code: string, message: string): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      error: {
        type: "authentication_error",
        code,
        message,
        status: 401,
      },
    })
  );
}
