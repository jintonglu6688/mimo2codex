// /admin/api/me/* endpoints — exercised through a real HTTP server so cookies
// + JSON wiring are tested end-to-end like the auth.flow suite.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { handleAdmin } from "../src/admin/router.js";
import { authGuard } from "../src/auth/middleware.js";
import { createUser } from "../src/db/users.js";
import { hashPassword } from "../src/security/passwords.js";
import { resetMasterKeyCache } from "../src/security/masterKey.js";
import type { Config } from "../src/config.js";

let dataDir: string;
let server: Server;
let port: number;

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

async function startTestServer(cfg: Config): Promise<{ server: Server; port: number }> {
  const srv = createServer((req, res) => {
    const guard = authGuard(cfg, req, res);
    if (guard.handled) return;
    void handleAdmin(cfg, req, res, guard.ctx);
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  const addr = srv.address();
  return { server: srv, port: addr && typeof addr === "object" ? addr.port : 0 };
}

interface CallOpts {
  cookie?: string;
  body?: unknown;
}

async function call(method: string, path: string, opts: CallOpts = {}): Promise<{
  status: number;
  json: any;
  setCookie: string | null;
}> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

async function loginAs(username: string, password: string): Promise<string> {
  const r = await call("POST", "/admin/api/auth/login", { body: { username, password } });
  const m = /m2c_session=([^;]+)/.exec(r.setCookie || "");
  return m ? `m2c_session=${m[1]}` : "";
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-me-test-"));
  openDb(dataDir);
  resetMasterKeyCache();
  ({ server, port } = await startTestServer(makeConfig()));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  resetMasterKeyCache();
});

describe("/admin/api/me/api-keys", () => {
  it("returns empty list before any keys are minted", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "alice", passwordHash: hash });
    const cookie = await loginAs("alice", "longerthan8");
    const r = await call("GET", "/admin/api/me/api-keys", { cookie });
    expect(r.status).toBe(200);
    expect(r.json.api_keys).toEqual([]);
  });

  it("POST mints a token, exposes it ONCE, and the metadata is queryable", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "bob", passwordHash: hash });
    const cookie = await loginAs("bob", "longerthan8");
    const mint = await call("POST", "/admin/api/me/api-keys", {
      cookie,
      body: { name: "laptop" },
    });
    expect(mint.status).toBe(200);
    expect(typeof mint.json.token).toBe("string");
    expect((mint.json.token as string).startsWith("m2c_")).toBe(true);
    expect(mint.json.api_key.name).toBe("laptop");
    expect((mint.json.api_key.key_prefix as string).startsWith("m2c_")).toBe(true);

    const list = await call("GET", "/admin/api/me/api-keys", { cookie });
    expect(list.json.api_keys.length).toBe(1);
    // Plaintext token is not surfaced anywhere after creation.
    expect((list.json.api_keys[0] as Record<string, unknown>).token).toBeUndefined();
  });

  it("DELETE revokes a key (subsequent listings still show it with revoked_at)", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "carol", passwordHash: hash });
    const cookie = await loginAs("carol", "longerthan8");
    const mint = await call("POST", "/admin/api/me/api-keys", { cookie, body: { name: "ci" } });
    const id = mint.json.api_key.id;
    const del = await call("DELETE", `/admin/api/me/api-keys/${id}`, { cookie });
    expect(del.status).toBe(200);
    expect(del.json.revoked).toBe(true);
    const list = await call("GET", "/admin/api/me/api-keys", { cookie });
    expect(list.json.api_keys[0].revoked_at).not.toBeNull();
  });

  it("/me/api-keys is per-user — alice never sees bob's keys", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "alice", passwordHash: hash });
    createUser({ username: "bob", passwordHash: hash });
    const ck1 = await loginAs("alice", "longerthan8");
    const ck2 = await loginAs("bob", "longerthan8");
    await call("POST", "/admin/api/me/api-keys", { cookie: ck1, body: { name: "a" } });
    await call("POST", "/admin/api/me/api-keys", { cookie: ck2, body: { name: "b" } });
    const a = await call("GET", "/admin/api/me/api-keys", { cookie: ck1 });
    const b = await call("GET", "/admin/api/me/api-keys", { cookie: ck2 });
    expect(a.json.api_keys.length).toBe(1);
    expect(b.json.api_keys.length).toBe(1);
    expect(a.json.api_keys[0].name).toBe("a");
    expect(b.json.api_keys[0].name).toBe("b");
  });
});

describe("/admin/api/me/upstream-keys (BYOK)", () => {
  it("set + list + delete round-trip", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "dave", passwordHash: hash });
    const cookie = await loginAs("dave", "longerthan8");

    const empty = await call("GET", "/admin/api/me/upstream-keys", { cookie });
    expect(empty.json.upstream_keys).toEqual([]);

    const put = await call("PUT", "/admin/api/me/upstream-keys/mimo", {
      cookie,
      body: { apiKey: "sk-byok-mimo" },
    });
    expect(put.status).toBe(200);

    const list = await call("GET", "/admin/api/me/upstream-keys", { cookie });
    expect(list.json.upstream_keys.length).toBe(1);
    expect(list.json.upstream_keys[0].provider_id).toBe("mimo");
    // No secret material on list response.
    expect((list.json.upstream_keys[0] as Record<string, unknown>).ciphertext).toBeUndefined();
    expect((list.json.upstream_keys[0] as Record<string, unknown>).api_key).toBeUndefined();

    const del = await call("DELETE", "/admin/api/me/upstream-keys/mimo", { cookie });
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);
    expect((await call("GET", "/admin/api/me/upstream-keys", { cookie })).json.upstream_keys).toEqual([]);
  });

  it("unknown provider id is 404", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "eve", passwordHash: hash });
    const cookie = await loginAs("eve", "longerthan8");
    const r = await call("PUT", "/admin/api/me/upstream-keys/not-a-provider", {
      cookie,
      body: { apiKey: "x" },
    });
    expect(r.status).toBe(404);
  });

  it("missing apiKey body is 400", async () => {
    const hash = await hashPassword("longerthan8");
    createUser({ username: "frank", passwordHash: hash });
    const cookie = await loginAs("frank", "longerthan8");
    const r = await call("PUT", "/admin/api/me/upstream-keys/mimo", { cookie, body: {} });
    expect(r.status).toBe(400);
  });

  it("requires a session — unauth returns 401", async () => {
    const r = await call("GET", "/admin/api/me/upstream-keys");
    expect(r.status).toBe(401);
  });
});
