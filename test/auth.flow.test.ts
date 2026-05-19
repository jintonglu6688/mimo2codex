// End-to-end auth pipeline test. Wires up authGuard + handleAdmin against a
// real http.Server so we exercise cookie/bearer parsing, status codes and the
// public-path whitelist exactly as production does.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { handleAdmin } from "../src/admin/router.js";
import { authGuard } from "../src/auth/middleware.js";
import { createApiKey } from "../src/db/apiKeys.js";
import { createUser, countUsers } from "../src/db/users.js";
import { hashPassword } from "../src/security/passwords.js";
import type { Config } from "../src/config.js";

let dataDir: string;
let server: Server;
let port: number;

function makeConfig(overrides: Partial<Config> = {}): Config {
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
      mimo: {
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "sk-test",
        flags: { isTokenPlan: false },
      },
      deepseek: null,
    },
    isTokenPlan: false,
    dataDir,
    adminEnabled: true,
    contextOverflowMode: "friendly",
    authMode: "on",
    cookieSecure: false,
    ...overrides,
  };
}

async function startTestServer(cfg: Config): Promise<{ server: Server; port: number }> {
  const srv = createServer((req, res) => {
    // Replicate server.ts's dispatch shape: authGuard, then either /v1/*
    // (echoed back) or /admin/* via handleAdmin.
    const url = req.url ?? "/";
    const guard = authGuard(cfg, req, res);
    if (guard.handled) return;
    if (url.startsWith("/v1/")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, user: guard.ctx.user?.username ?? null }));
      return;
    }
    if (url === "/admin" || url.startsWith("/admin/")) {
      void handleAdmin(cfg, req, res, guard.ctx);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  const addr = srv.address();
  const p = addr && typeof addr === "object" ? addr.port : 0;
  return { server: srv, port: p };
}

interface CallOpts {
  cookie?: string;
  bearer?: string;
  body?: unknown;
}

async function call(
  method: string,
  path: string,
  opts: CallOpts = {}
): Promise<{ status: number; json: unknown; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = /m2c_session=([^;]+)/.exec(setCookie);
  return m ? `m2c_session=${m[1]}` : null;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-authflow-test-"));
  openDb(dataDir);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("authMode='off' — local mode is fully open", () => {
  beforeEach(async () => {
    const cfg = makeConfig({ authMode: "off" });
    ({ server, port } = await startTestServer(cfg));
  });

  it("/v1/* needs no Authorization header", async () => {
    const r = await call("GET", "/v1/anything");
    expect(r.status).toBe(200);
  });

  it("/admin/api/health is reachable without cookies", async () => {
    const r = await call("GET", "/admin/api/health");
    expect(r.status).toBe(200);
    expect((r.json as { authMode: string }).authMode).toBe("off");
  });

  it("/admin/api/auth/me returns user:null and authMode='off'", async () => {
    const r = await call("GET", "/admin/api/auth/me");
    expect(r.status).toBe(200);
    expect((r.json as { user: unknown; authMode: string }).user).toBeNull();
    expect((r.json as { authMode: string }).authMode).toBe("off");
  });

  it("login endpoint rejects with 400 (login is meaningless in local mode)", async () => {
    const r = await call("POST", "/admin/api/auth/login", {
      body: { username: "x", password: "y" },
    });
    expect(r.status).toBe(400);
  });
});

describe("authMode='on' — guard rejects unauth /v1/* and protected /admin/api/*", () => {
  beforeEach(async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
  });

  it("/v1/* with no Authorization returns 401", async () => {
    const r = await call("POST", "/v1/responses", { body: { model: "mimo-v2.5-pro" } });
    expect(r.status).toBe(401);
    expect((r.json as { error: { code: string } }).error.code).toBe("missing_bearer");
  });

  it("/v1/* with garbage bearer returns 401", async () => {
    const r = await call("POST", "/v1/responses", {
      bearer: "not-an-m2c-key",
      body: { model: "mimo-v2.5-pro" },
    });
    expect(r.status).toBe(401);
  });

  it("/v1/* with a valid per-user API key is admitted", async () => {
    const user = createUser({ username: "alice", isAdmin: false });
    const { token } = createApiKey(user.id, "laptop");
    const r = await call("POST", "/v1/responses", {
      bearer: token,
      body: { model: "mimo-v2.5-pro" },
    });
    expect(r.status).toBe(200);
    expect((r.json as { user: string }).user).toBe("alice");
  });

  it("/admin/api/providers without session is 401", async () => {
    const r = await call("GET", "/admin/api/providers");
    expect(r.status).toBe(401);
  });

  it("public endpoints are reachable without a session: health, bootstrap, auth/me, auth/login", async () => {
    expect((await call("GET", "/admin/api/health")).status).toBe(200);
    expect((await call("GET", "/admin/api/auth/me")).status).toBe(200);
    expect((await call("POST", "/admin/api/auth/login", { body: {} })).status).toBe(400); // hits handler, returns 400
  });
});

describe("bootstrap flow", () => {
  beforeEach(async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
  });

  it("/admin/api/auth/me reports needsBootstrap=true on an empty DB", async () => {
    const r = await call("GET", "/admin/api/auth/me");
    expect((r.json as { needsBootstrap: boolean }).needsBootstrap).toBe(true);
  });

  it("POST /admin/api/bootstrap creates the first admin and returns a session cookie", async () => {
    const r = await call("POST", "/admin/api/bootstrap", {
      body: { username: "root", password: "supersecret" },
    });
    expect(r.status).toBe(200);
    expect((r.json as { user: { is_admin: boolean } }).user.is_admin).toBe(true);
    expect(r.setCookie).toMatch(/m2c_session=/);
    expect(countUsers()).toBe(1);

    // Subsequent attempts fail because users > 0.
    const r2 = await call("POST", "/admin/api/bootstrap", {
      body: { username: "root2", password: "supersecret" },
    });
    expect(r2.status).toBe(409);
    expect((r2.json as { error: { code: string } }).error.code).toBe("already_initialized");
  });

  it("bootstrap rejects weak passwords and missing fields", async () => {
    const weak = await call("POST", "/admin/api/bootstrap", {
      body: { username: "root", password: "short" },
    });
    expect(weak.status).toBe(400);
    expect((weak.json as { error: { code: string } }).error.code).toBe("weak_password");

    const missing = await call("POST", "/admin/api/bootstrap", {
      body: { username: "root" },
    });
    expect(missing.status).toBe(400);
    expect((missing.json as { error: { code: string } }).error.code).toBe("invalid_body");
  });
});

describe("login + logout flow", () => {
  beforeEach(async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
  });

  it("login with correct credentials returns user + cookie, /me echoes back, logout clears", async () => {
    const hash = await hashPassword("correct-horse");
    createUser({ username: "bob", passwordHash: hash, isAdmin: false });

    const login = await call("POST", "/admin/api/auth/login", {
      body: { username: "bob", password: "correct-horse" },
    });
    expect(login.status).toBe(200);
    const cookie = extractSessionCookie(login.setCookie);
    expect(cookie).not.toBeNull();

    const me = await call("GET", "/admin/api/auth/me", { cookie: cookie! });
    expect(me.status).toBe(200);
    expect((me.json as { user: { username: string } | null }).user?.username).toBe("bob");

    const logout = await call("POST", "/admin/api/auth/logout", { cookie: cookie! });
    expect(logout.status).toBe(200);
    expect(logout.setCookie).toMatch(/m2c_session=;.*Max-Age=0/);

    // After logout the cookie no longer resolves a session.
    const me2 = await call("GET", "/admin/api/auth/me", { cookie: cookie! });
    expect((me2.json as { user: unknown }).user).toBeNull();
  });

  it("login with wrong password is 401", async () => {
    const hash = await hashPassword("real");
    createUser({ username: "carol", passwordHash: hash });
    const r = await call("POST", "/admin/api/auth/login", {
      body: { username: "carol", password: "fake" },
    });
    expect(r.status).toBe(401);
  });

  it("login refuses disabled users", async () => {
    const hash = await hashPassword("realpass");
    const u = createUser({ username: "dora", passwordHash: hash });
    const { updateUser } = await import("../src/db/users.js");
    updateUser(u.id, { status: "disabled" });
    const r = await call("POST", "/admin/api/auth/login", {
      body: { username: "dora", password: "realpass" },
    });
    expect(r.status).toBe(401);
  });
});

describe("self-registration", () => {
  beforeEach(async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
  });

  async function loginAs(username: string, password: string): Promise<string> {
    const r = await call("POST", "/admin/api/auth/login", { body: { username, password } });
    return extractSessionCookie(r.setCookie)!;
  }

  it("/auth/register is 403 when allowRegister is off (default)", async () => {
    // Need a user to exist so we're past the bootstrap window.
    const hash = await hashPassword("longerthan8");
    createUser({ username: "root", passwordHash: hash, isAdmin: true });
    const r = await call("POST", "/admin/api/auth/register", {
      body: { username: "newcomer", password: "longerthan8" },
    });
    expect(r.status).toBe(403);
    expect((r.json as { error: { code: string } }).error.code).toBe("register_disabled");
  });

  it("/auth/me.allowRegister reflects the setting + admin toggles it", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "root", passwordHash: hash, isAdmin: true });
    const cookie = (await loginAs("root", "longerthan8"));

    // Off by default.
    const me0 = await call("GET", "/admin/api/auth/me");
    expect((me0.json as { allowRegister: boolean }).allowRegister).toBe(false);

    // Admin flips it on.
    const put = await call("PUT", "/admin/api/auth/register-policy", {
      cookie,
      body: { allowRegister: true },
    });
    expect(put.status).toBe(200);
    expect((put.json as { allowRegister: boolean }).allowRegister).toBe(true);

    // /me now reports allowRegister=true even unauth.
    const me1 = await call("GET", "/admin/api/auth/me");
    expect((me1.json as { allowRegister: boolean }).allowRegister).toBe(true);
  });

  it("/auth/register creates a non-admin account + auto-logs-in when policy is on", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "root", passwordHash: hash, isAdmin: true });
    const cookie = (await loginAs("root", "longerthan8"));
    await call("PUT", "/admin/api/auth/register-policy", {
      cookie,
      body: { allowRegister: true },
    });

    const r = await call("POST", "/admin/api/auth/register", {
      body: { username: "newcomer", password: "longerthan8", displayName: "Newbie" },
    });
    expect(r.status).toBe(200);
    expect((r.json as { user: { is_admin: boolean } }).user.is_admin).toBe(false);
    expect(r.setCookie).toMatch(/m2c_session=/);

    // Duplicate username is 409.
    const dup = await call("POST", "/admin/api/auth/register", {
      body: { username: "newcomer", password: "longerthan8" },
    });
    expect(dup.status).toBe(409);
  });

  it("/auth/register-policy is admin-only", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "root", passwordHash: hash, isAdmin: true });
    createUser({ username: "user1", passwordHash: hash, isAdmin: false });
    const userCookie = await loginAs("user1", "longerthan8");
    const r = await call("PUT", "/admin/api/auth/register-policy", {
      cookie: userCookie,
      body: { allowRegister: true },
    });
    expect(r.status).toBe(403);
  });
});

describe("admin user-management endpoints", () => {
  beforeEach(async () => {
    const cfg = makeConfig();
    ({ server, port } = await startTestServer(cfg));
  });

  async function setupAdmin(): Promise<string> {
    const hash = await hashPassword("adminpass");
    createUser({ username: "root", passwordHash: hash, isAdmin: true });
    const login = await call("POST", "/admin/api/auth/login", {
      body: { username: "root", password: "adminpass" },
    });
    return extractSessionCookie(login.setCookie)!;
  }

  it("non-admin session is 403 on /admin/api/users", async () => {
    const hash = await hashPassword("upass");
    createUser({ username: "user1", passwordHash: hash, isAdmin: false });
    const login = await call("POST", "/admin/api/auth/login", {
      body: { username: "user1", password: "upass" },
    });
    const cookie = extractSessionCookie(login.setCookie)!;
    const r = await call("GET", "/admin/api/users", { cookie });
    expect(r.status).toBe(403);
  });

  it("admin can create + patch users + sees per-user usage fields", async () => {
    const cookie = await setupAdmin();
    const create = await call("POST", "/admin/api/users", {
      cookie,
      body: { username: "newbie", password: "longerthan8" },
    });
    expect(create.status).toBe(200);
    const id = (create.json as { user: { id: number } }).user.id;

    const patch = await call("PATCH", `/admin/api/users/${id}`, {
      cookie,
      body: { status: "disabled", displayName: "Newbie Esq." },
    });
    expect(patch.status).toBe(200);
    expect((patch.json as { user: { status: string } }).user.status).toBe("disabled");

    const list = await call("GET", "/admin/api/users", { cookie });
    expect(list.status).toBe(200);
    const users = (list.json as {
      users: Array<{
        username: string;
        request_count: number;
        total_tokens: number;
        last_activity: number | null;
      }>;
    }).users;
    expect(users.length).toBe(2);
    // Usage fields are present and zeroed for accounts with no requests yet.
    const newbie = users.find((u) => u.username === "newbie")!;
    expect(newbie.request_count).toBe(0);
    expect(newbie.total_tokens).toBe(0);
    expect(newbie.last_activity).toBeNull();
  });

  it("creating a duplicate username is 409", async () => {
    const cookie = await setupAdmin();
    await call("POST", "/admin/api/users", {
      cookie,
      body: { username: "dup", password: "longerthan8" },
    });
    const dup = await call("POST", "/admin/api/users", {
      cookie,
      body: { username: "dup", password: "longerthan8" },
    });
    expect(dup.status).toBe(409);
  });
});
