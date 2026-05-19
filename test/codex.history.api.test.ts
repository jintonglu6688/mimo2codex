// End-to-end test of the codex-history + bundle endpoints. We exercise the
// real HTTP server so cookie scoping + JSON wiring is covered.

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
let codexHome: string;
let server: Server;
let port: number;

function makeConfig(authMode: "off" | "on"): Config {
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
    authMode,
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

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-codex-hist-api-"));
  codexHome = mkdtempSync(join(tmpdir(), "m2c-codex-hist-home-"));
  // Sandbox CODEX_HOME so applyCodex writes into an isolated dir; admin.api
  // tests use the same trick.
  process.env.CODEX_HOME = codexHome;
  openDb(dataDir);
  resetMasterKeyCache();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
  delete process.env.CODEX_HOME;
  resetMasterKeyCache();
});

describe("codex-history in server mode", () => {
  it("apply records a history row scoped to the calling user and returns bundleUrl", async () => {
    ({ server, port } = await startTestServer(makeConfig("on")));
    const hash = await hashPassword("longerthan8");
    createUser({ username: "alice", passwordHash: hash, isAdmin: true });
    const cookie = await loginAs("alice", "longerthan8");

    const apply = await call("POST", "/admin/api/codex-apply", {
      cookie,
      body: { providerId: "mimo", modelId: "mimo-v2.5-pro" },
    });
    expect(apply.status).toBe(200);
    expect(apply.json.historyId).toBeGreaterThan(0);
    expect(apply.json.bundleUrl).toBe(`/admin/api/codex-history/${apply.json.historyId}/bundle`);

    const hist = await call("GET", "/admin/api/codex-history", { cookie });
    expect(hist.status).toBe(200);
    expect(hist.json.history.length).toBe(1);
    expect(hist.json.history[0].kind).toBe("apply");
    expect(hist.json.history[0].provider_id).toBe("mimo");
    expect(hist.json.history[0].model_id).toBe("mimo-v2.5-pro");

    const bundle = await call("GET", `/admin/api/codex-history/${apply.json.historyId}/bundle`, { cookie });
    expect(bundle.status).toBe(200);
    // The bundle returns the auth.json with the placeholder OPENAI_API_KEY.
    // Users are expected to mint a key explicitly under My Account and
    // paste it in before running apply.sh / apply.ps1.
    expect(bundle.json.files.authJson).toContain("mimo2codex-local");
    expect(bundle.json.mintedKey).toBeNull();
    expect(bundle.json.files.configToml).toContain('model = "mimo-v2.5-pro"');
    expect(bundle.json.scripts.posix).toContain("#!/usr/bin/env bash");
    expect(bundle.json.scripts.powershell).toContain('Set-Content');
  });

  it("history is scoped per user — alice cannot read bob's bundle", async () => {
    ({ server, port } = await startTestServer(makeConfig("on")));
    const hash = await hashPassword("longerthan8");
    createUser({ username: "alice", passwordHash: hash, isAdmin: false });
    createUser({ username: "bob", passwordHash: hash, isAdmin: false });
    const ckA = await loginAs("alice", "longerthan8");
    const ckB = await loginAs("bob", "longerthan8");

    const apply = await call("POST", "/admin/api/codex-apply", {
      cookie: ckA,
      body: { providerId: "mimo", modelId: "mimo-v2.5-pro" },
    });
    const otherUserAttempt = await call(
      "GET",
      `/admin/api/codex-history/${apply.json.historyId}/bundle`,
      { cookie: ckB }
    );
    expect(otherUserAttempt.status).toBe(403);

    // Bob's own history is empty.
    const bobHist = await call("GET", "/admin/api/codex-history", { cookie: ckB });
    expect(bobHist.json.history.length).toBe(0);
  });

  it("does not write filesystem in server mode (codex_home stays clean)", async () => {
    ({ server, port } = await startTestServer(makeConfig("on")));
    const hash = await hashPassword("longerthan8");
    createUser({ username: "carol", passwordHash: hash, isAdmin: true });
    const cookie = await loginAs("carol", "longerthan8");
    await call("POST", "/admin/api/codex-apply", {
      cookie,
      body: { providerId: "mimo", modelId: "mimo-v2.5-pro" },
    });
    // Filesystem should be untouched — applyCodex was not called.
    const fsSync = await import("node:fs");
    expect(fsSync.existsSync(join(codexHome, "auth.json"))).toBe(false);
    expect(fsSync.existsSync(join(codexHome, "config.toml"))).toBe(false);
  });

  it("DELETE history row removes non-initial entries", async () => {
    ({ server, port } = await startTestServer(makeConfig("on")));
    const hash = await hashPassword("longerthan8");
    createUser({ username: "dora", passwordHash: hash, isAdmin: true });
    const cookie = await loginAs("dora", "longerthan8");
    const apply = await call("POST", "/admin/api/codex-apply", {
      cookie,
      body: { providerId: "mimo", modelId: "mimo-v2.5-pro" },
    });
    const del = await call("DELETE", `/admin/api/codex-history/${apply.json.historyId}`, { cookie });
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);
    const hist = await call("GET", "/admin/api/codex-history", { cookie });
    expect(hist.json.history.length).toBe(0);
  });
});

describe("codex-history in local mode", () => {
  it("apply writes files AND records history with shared (null user_id) timeline", async () => {
    ({ server, port } = await startTestServer(makeConfig("off")));
    const apply = await call("POST", "/admin/api/codex-apply", {
      body: { providerId: "mimo", modelId: "mimo-v2.5-pro" },
    });
    expect(apply.status).toBe(200);
    expect(apply.json.historyId).toBeGreaterThan(0);
    // bundleUrl is null in local mode — the UI is supposed to render
    // 'config applied locally' instead of a download button.
    expect(apply.json.bundleUrl).toBeNull();
    // Backup pair is still created via the existing applyCodex flow.
    expect(apply.json.backupTs).toBeTypeOf("number");

    const fsSync = await import("node:fs");
    expect(fsSync.existsSync(join(codexHome, "auth.json"))).toBe(true);
    expect(fsSync.existsSync(join(codexHome, "config.toml"))).toBe(true);

    const hist = await call("GET", "/admin/api/codex-history");
    expect(hist.json.history.length).toBeGreaterThanOrEqual(1);
    // First-ever apply on a non-empty pre-existing codex dir would also have
    // appended an 'initial' row; since the codex home was empty before, the
    // captureInitialCodexSnapshot fires but stores an "empty" placeholder.
    // Either way `apply` row is present.
    expect(hist.json.history.some((r: { kind: string }) => r.kind === "apply")).toBe(true);
  });
});
