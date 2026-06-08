import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, openDb, getDb } from "../src/db/index.js";
import { insertLog, queryLogs } from "../src/db/logs.js";
import type { Config } from "../src/config.js";
import {
  applyLogBodyMode,
  resolveLogBodyMode,
  resolveLogRetentionDays,
  runLogMaintenance,
} from "../src/logging/settings.js";
import { getSetting, setSetting } from "../src/db/settings.js";

let dataDir: string;

const cfg: Config = {
  host: "127.0.0.1",
  port: 8788,
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
  dataDir: "",
  adminEnabled: true,
  contextOverflowMode: "friendly",
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-log-settings-"));
  openDb(dataDir);
  cfg.dataDir = dataDir;
  cfg.logBodyModeFromCli = undefined;
  cfg.logRetentionDaysFromCli = undefined;
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("logging settings", () => {
  it("fresh install defaults to errors-only bodies and a 30-day retention window", () => {
    // issue #67: a brand-new db seeds opinionated defaults so it can't balloon.
    expect(resolveLogBodyMode(cfg)).toBe("errors-only");
    expect(resolveLogRetentionDays(cfg)).toBe(30);
  });

  it("uses settings values when no env override is present", () => {
    setSetting("logging.bodyMode", "errors-only");
    setSetting("logging.retentionDays", "14");
    expect(resolveLogBodyMode(cfg)).toBe("errors-only");
    expect(resolveLogRetentionDays(cfg)).toBe(14);
  });

  it("env overrides win over settings for body mode and retention", () => {
    setSetting("logging.bodyMode", "off");
    setSetting("logging.retentionDays", "30");
    cfg.logBodyModeFromCli = "full";
    cfg.logRetentionDaysFromCli = 7;
    expect(resolveLogBodyMode(cfg)).toBe("full");
    expect(resolveLogRetentionDays(cfg)).toBe(7);
  });

  it("errors-only keeps bodies for failures and strips them for success", () => {
    expect(
      applyLogBodyMode("errors-only", 200, { requestBody: '{"a":1}', responseBody: '{"b":2}' })
    ).toEqual({
      requestBody: null,
      responseBody: null,
    });
    expect(
      applyLogBodyMode("errors-only", 502, { requestBody: '{"a":1}', responseBody: '{"b":2}' })
    ).toEqual({
      requestBody: '{"a":1}',
      responseBody: '{"b":2}',
    });
  });

  it("off strips bodies regardless of status code", () => {
    expect(
      applyLogBodyMode("off", 500, { requestBody: '{"a":1}', responseBody: '{"b":2}' })
    ).toEqual({
      requestBody: null,
      responseBody: null,
    });
  });

  it("maintenance run deletes logs older than configured retention", () => {
    const now = Date.UTC(2026, 4, 30);
    insertLog({
      ts: now - 20 * 24 * 60 * 60 * 1000,
      request_id: "old",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 1,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      stream: false,
      error_code: null,
      error_snippet: null,
      request_body: null,
      response_body: null,
      tool_call_count: null,
    });
    insertLog({
      ts: now - 2 * 24 * 60 * 60 * 1000,
      request_id: "new",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 1,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      stream: false,
      error_code: null,
      error_snippet: null,
      request_body: null,
      response_body: null,
      tool_call_count: null,
    });
    setSetting("logging.retentionDays", "7");

    const result = runLogMaintenance(cfg, now);

    expect(result).toMatchObject({ retentionDays: 7, removed: 1 });
    expect(queryLogs({ limit: 10 }).map((row) => row.request_id)).toEqual(["new"]);
  });

  it("size cap trims the oldest logs when db exceeds maxDbSizeMb", () => {
    setSetting("logging.retentionDays", "off"); // isolate the size cap from age-based retention
    const big = "x".repeat(8 * 1024);
    for (let i = 0; i < 400; i++) {
      insertLog({
        ts: Date.UTC(2026, 0, 1) + i * 1000,
        request_id: `bulk-${i}`,
        provider_id: "mimo",
        client_model: "m",
        upstream_model: "m",
        endpoint: "/v1/responses",
        status_code: 200,
        duration_ms: 1,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        stream: false,
        error_code: null,
        error_snippet: null,
        request_body: big,
        response_body: big,
        tool_call_count: null,
      });
    }
    getDb().pragma("wal_checkpoint(TRUNCATE)");
    setSetting("logging.maxDbSizeMb", "1"); // 1 MB cap, far below the ~6 MB db
    const before = queryLogs({ limit: 10000 }).length;
    const result = runLogMaintenance(cfg, Date.now());
    const after = queryLogs({ limit: 10000 }).length;
    expect(result.removedBySize).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it("auto-vacuums after deletions and throttles repeat vacuums within a day", () => {
    const mkOld = (id: string, ts: number): void =>
      insertLog({
        ts,
        request_id: id,
        provider_id: "mimo",
        client_model: "m",
        upstream_model: "m",
        endpoint: "/v1/responses",
        status_code: 200,
        duration_ms: 1,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        stream: false,
        error_code: null,
        error_snippet: null,
        request_body: null,
        response_body: null,
        tool_call_count: null,
      });
    mkOld("old-1", Date.UTC(2026, 3, 1));
    setSetting("logging.retentionDays", "7");
    const now = Date.UTC(2026, 4, 30);
    const r1 = runLogMaintenance(cfg, now);
    expect(r1.removed).toBe(1);
    expect(r1.vacuumed).toBe(true);
    expect(getSetting("logging.lastVacuumAt")).toBe(String(now));

    mkOld("old-2", Date.UTC(2026, 3, 2));
    const r2 = runLogMaintenance(cfg, now + 60 * 60 * 1000); // +1h
    expect(r2.removed).toBe(1);
    expect(r2.vacuumed).toBe(false); // throttled: < 24h since last vacuum
  });
});
