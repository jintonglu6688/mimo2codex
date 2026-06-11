import { describe, expect, it, afterEach } from "vitest";
import type { Server } from "node:http";
import type { Config } from "../src/config.js";
import { startServer } from "../src/server.js";

// Regression for the desktop mac-arm64 "/admin/ → no route 404" symptom: when
// better-sqlite3 fails to load at startup, cli.ts force-disables admin and sets
// cfg.adminDisabledReason. server.ts must then serve a CLEAR diagnostic on
// /admin/ (503 admin_db_unavailable) instead of the misleading generic 404,
// and keep /admin/api/health answering so CI / the desktop shell can probe.

let server: Server;

function baseCfg(): Config {
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
    dataDir: "",
    adminEnabled: false,
    contextOverflowMode: "friendly",
  } as Config;
}

async function listen(cfg: Config): Promise<number> {
  server = startServer(cfg);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  return addr && typeof addr === "object" ? addr.port : 0;
}

async function get(port: number, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, json };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("admin force-disabled by DB load failure", () => {
  it("GET /admin/ returns a 503 admin_db_unavailable diagnostic (not a 404)", async () => {
    const cfg = baseCfg();
    cfg.adminDisabledReason = {
      message: "dlopen failed: incompatible architecture",
      likelyBinding: true,
      dataDir: "/tmp/data",
    };
    const port = await listen(cfg);
    const { status, json } = await get(port, "/admin/");
    expect(status).toBe(503);
    expect(json.error.code).toBe("admin_db_unavailable");
    expect(json.error.type).toBe("server_error");
    expect(json.error.message).toContain("incompatible architecture");
  });

  it("GET /admin/api/health still answers 200 with adminEnabled:false + reason", async () => {
    const cfg = baseCfg();
    cfg.adminDisabledReason = {
      message: "NODE_MODULE_VERSION mismatch",
      likelyBinding: true,
      dataDir: "/tmp/data",
    };
    const port = await listen(cfg);
    const { status, json } = await get(port, "/admin/api/health");
    expect(status).toBe(200);
    expect(json.adminEnabled).toBe(false);
    expect(json.reason).toBe("db_unavailable");
    expect(json.message).toContain("NODE_MODULE_VERSION");
  });

  it("intentional --no-admin (no reason set) keeps the historic 404", async () => {
    const cfg = baseCfg(); // adminEnabled:false, adminDisabledReason undefined
    const port = await listen(cfg);
    const { status, json } = await get(port, "/admin/");
    expect(status).toBe(404);
    expect(json.error.code).toBe("not_found");
  });
});
