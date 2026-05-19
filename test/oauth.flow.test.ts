// OAuth route exercises: state issuance, callback validation, code exchange
// via injected fetch mock, and user upsert. We don't hit github.com or
// gitee.com — the OAuth module accepts a fetch override for exactly this.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { closeDb, openDb } from "../src/db/index.js";
import { authGuard } from "../src/auth/middleware.js";
import { handleAdmin } from "../src/admin/router.js";
import { handleOAuthRoutes } from "../src/auth/oauthRoutes.js";
import { upsertOAuthClient } from "../src/db/oauthClients.js";
import { findIdentity } from "../src/db/oauthIdentities.js";
import { findUserByUsername } from "../src/db/users.js";
import { findSessionByToken } from "../src/db/sessions.js";
import {
  loadMasterKey,
  resetMasterKeyCache,
} from "../src/security/masterKey.js";
import type { Config } from "../src/config.js";

let dataDir: string;
let server: Server;
let port: number;
let lastFetchCalls: Array<{ url: string; init?: RequestInit }>;

function makeConfig(): Config {
  return {
    host: "127.0.0.1",
    port: 0,
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "sk-test",
    exposeReasoning: true,
    verbose: false,
    userAgent: "mimo2codex/test",
    defaultProviderId: "mimo",
    providers: {
      mimo: { baseUrl: "https://api.xiaomimimo.com/v1", apiKey: "sk-test", flags: { isTokenPlan: false } },
      deepseek: null,
    },
    isTokenPlan: false,
    dataDir,
    adminEnabled: true,
    contextOverflowMode: "friendly",
    authMode: "on",
    cookieSecure: false,
  };
}

// Mock fetch that returns whatever response the test seeded.
function mockFetch(plan: Array<{ match: string | RegExp; body: unknown; ok?: boolean; status?: number }>): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    lastFetchCalls.push({ url, init });
    for (const step of plan) {
      const isMatch =
        typeof step.match === "string" ? url.startsWith(step.match) : step.match.test(url);
      if (isMatch) {
        const text = typeof step.body === "string" ? step.body : JSON.stringify(step.body);
        return new Response(text, {
          status: step.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("no mock match", { status: 599 });
  }) as typeof fetch;
}

async function startTestServer(cfg: Config, oauthFetch?: typeof fetch): Promise<{ server: Server; port: number }> {
  const srv = createServer((req, res) => {
    const guard = authGuard(cfg, req, res);
    if (guard.handled) return;
    const url = req.url ?? "/";
    if (url.startsWith("/oauth/")) {
      void handleOAuthRoutes(cfg, req, res, oauthFetch ? { fetch: oauthFetch } : {});
      return;
    }
    void handleAdmin(cfg, req, res, guard.ctx);
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  const addr = srv.address();
  return { server: srv, port: addr && typeof addr === "object" ? addr.port : 0 };
}

async function fetchNoRedirect(path: string, opts: RequestInit = {}): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, redirect: "manual" });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-oauth-flow-"));
  openDb(dataDir);
  resetMasterKeyCache();
  lastFetchCalls = [];
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  resetMasterKeyCache();
});

describe("/oauth/login/:provider", () => {
  it("302 redirects to GitHub authorize URL with state + scope", async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
    const { key } = loadMasterKey(cfg.dataDir);
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "client-abc",
        clientSecret: "shh",
        callbackUrl: "https://example.com/oauth/callback/github",
        enabled: true,
      },
      key
    );
    const res = await fetchNoRedirect("/oauth/login/github");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    const u = new URL(loc);
    expect(u.hostname).toBe("github.com");
    expect(u.searchParams.get("client_id")).toBe("client-abc");
    expect(u.searchParams.get("redirect_uri")).toBe("https://example.com/oauth/callback/github");
    expect(u.searchParams.get("scope")).toBe("read:user user:email");
    expect(u.searchParams.get("state")?.startsWith("m2co_")).toBe(true);
  });

  it("rejects unknown provider", async () => {
    ({ server, port } = await startTestServer(makeConfig()));
    const res = await fetchNoRedirect("/oauth/login/twitter");
    expect(res.status).toBe(400);
  });

  it("rejects when provider is not enabled in admin config", async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
    const { key } = loadMasterKey(cfg.dataDir);
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "x",
        clientSecret: "y",
        callbackUrl: "https://x/cb",
        enabled: false,
      },
      key
    );
    const res = await fetchNoRedirect("/oauth/login/github");
    expect(res.status).toBe(400);
  });
});

describe("/oauth/callback/:provider", () => {
  async function seedClientAndCaptureState(): Promise<{ state: string }> {
    const cfg = makeConfig();
    const { key } = loadMasterKey(cfg.dataDir);
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "client-abc",
        clientSecret: "shh",
        callbackUrl: "https://example.com/oauth/callback/github",
        enabled: true,
      },
      key
    );
    const res = await fetchNoRedirect("/oauth/login/github");
    const loc = new URL(res.headers.get("location")!);
    return { state: loc.searchParams.get("state")! };
  }

  it("happy path: exchanges code, creates user, sets session cookie, redirects to /admin/", async () => {
    const fetchPlan = mockFetch([
      { match: "https://github.com/login/oauth/access_token", body: { access_token: "tok-abc" } },
      {
        match: "https://api.github.com/user",
        body: { id: 42, login: "octo", name: "Octo Cat", avatar_url: "https://a/avatar.png" },
      },
    ]);
    ({ server, port } = await startTestServer(makeConfig(), fetchPlan));
    const { state } = await seedClientAndCaptureState();

    const res = await fetchNoRedirect(`/oauth/callback/github?code=fake-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/m2c_session=/);

    // User row was created and linked.
    const user = findUserByUsername("github_octo");
    expect(user).not.toBeNull();
    expect(user!.password_hash).toBeNull();
    const linked = findIdentity("github", "42");
    expect(linked).not.toBeNull();
    expect(linked!.user_id).toBe(user!.id);

    // Session is real (the cookie actually maps to a row).
    const token = setCookie!.match(/m2c_session=([^;]+)/)![1];
    const found = findSessionByToken(token);
    expect(found?.user.id).toBe(user!.id);

    // Token exchange + user fetch both fired.
    expect(lastFetchCalls.some((c) => c.url.includes("oauth/access_token"))).toBe(true);
    expect(lastFetchCalls.some((c) => c.url.includes("api.github.com/user"))).toBe(true);
  });

  it("rejects when state is invalid or already used", async () => {
    const fetchPlan = mockFetch([
      { match: "https://github.com/login/oauth/access_token", body: { access_token: "tok-abc" } },
      { match: "https://api.github.com/user", body: { id: 42, login: "octo" } },
    ]);
    ({ server, port } = await startTestServer(makeConfig(), fetchPlan));
    const { state } = await seedClientAndCaptureState();

    // First callback succeeds.
    const first = await fetchNoRedirect(`/oauth/callback/github?code=c&state=${state}`);
    expect(first.status).toBe(302);

    // Second callback reusing the same state is rejected (single-use).
    const second = await fetchNoRedirect(`/oauth/callback/github?code=c&state=${state}`);
    expect(second.status).toBe(400);

    // Bogus state is rejected.
    const bogus = await fetchNoRedirect(`/oauth/callback/github?code=c&state=m2co_garbage`);
    expect(bogus.status).toBe(400);
  });

  it("re-linking an existing identity does not create duplicate users", async () => {
    const fetchPlan = mockFetch([
      { match: "https://github.com/login/oauth/access_token", body: { access_token: "tok-abc" } },
      { match: "https://api.github.com/user", body: { id: 42, login: "octo", name: "Octo Cat" } },
    ]);
    ({ server, port } = await startTestServer(makeConfig(), fetchPlan));

    // First login.
    const a = await seedClientAndCaptureState();
    await fetchNoRedirect(`/oauth/callback/github?code=c&state=${a.state}`);
    const userBefore = findUserByUsername("github_octo")!;

    // Second login — same provider user id.
    const b = await seedClientAndCaptureState();
    await fetchNoRedirect(`/oauth/callback/github?code=c&state=${b.state}`);
    const userAfter = findUserByUsername("github_octo")!;
    expect(userAfter.id).toBe(userBefore.id);
  });

  it("rejects when code exchange fails", async () => {
    const fetchPlan = mockFetch([
      { match: "https://github.com/login/oauth/access_token", body: { error: "bad_code" }, status: 401 },
    ]);
    ({ server, port } = await startTestServer(makeConfig(), fetchPlan));
    const { state } = await seedClientAndCaptureState();
    const res = await fetchNoRedirect(`/oauth/callback/github?code=c&state=${state}`);
    expect(res.status).toBe(400);
  });
});

describe("admin oauth-clients endpoints", () => {
  it("public providers endpoint returns only enabled providers without secret", async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
    const { key } = loadMasterKey(cfg.dataDir);
    upsertOAuthClient(
      { provider: "github", clientId: "g1", clientSecret: "s", callbackUrl: "u", enabled: true },
      key
    );
    upsertOAuthClient(
      { provider: "gitee", clientId: "g2", clientSecret: "s", callbackUrl: "u", enabled: false },
      key
    );
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/auth/oauth-providers`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers.length).toBe(1);
    expect(json.providers[0].provider).toBe("github");
    expect(JSON.stringify(json)).not.toContain("client_secret");
  });
});
