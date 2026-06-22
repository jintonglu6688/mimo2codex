import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb, getDb } from "../src/db/index.js";
import {
  insertLog,
  aggregateStats,
  aggregateProviderHealth,
  aggregateLatency,
  aggregateMappings,
  aggregateTokensTimeseries,
  type ChatLogEntry,
} from "../src/db/logs.js";
import {
  floorHourMs,
  latencyBucketIndex,
  backfillStatsChunk,
  isStatsBackfillDone,
} from "../src/db/stats.js";
import { setSetting } from "../src/db/settings.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-stats-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

const HOUR = 3_600_000;
// A fixed, hour-aligned base so floorHourMs() is deterministic in assertions.
const BASE = Math.floor(1_700_000_000_000 / HOUR) * HOUR;

function entry(over: Partial<ChatLogEntry> = {}): ChatLogEntry {
  return {
    ts: BASE,
    request_id: null,
    provider_id: "mimo",
    client_model: "mimo-v2.5-pro",
    upstream_model: "mimo-v2.5-pro",
    endpoint: "/v1/responses",
    status_code: 200,
    duration_ms: 10,
    prompt_tokens: 5,
    completion_tokens: 7,
    total_tokens: 12,
    stream: false,
    error_code: null,
    error_snippet: null,
    request_body: null,
    response_body: null,
    tool_call_count: null,
    cached_tokens: 0,
    ...over,
  };
}

// Raw insert that bypasses the rollup — simulates "logs that existed before the
// stats feature shipped" for the backfill test.
function rawInsertLog(e: ChatLogEntry): void {
  getDb()
    .prepare(
      `INSERT INTO chat_logs (
        ts, request_id, provider_id, client_model, upstream_model, endpoint,
        status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens,
        stream, error_code, error_snippet, request_body, response_body,
        tool_call_count, cached_tokens, user_id
      ) VALUES (
        @ts, @request_id, @provider_id, @client_model, @upstream_model, @endpoint,
        @status_code, @duration_ms, @prompt_tokens, @completion_tokens, @total_tokens,
        @stream, @error_code, @error_snippet, @request_body, @response_body,
        @tool_call_count, @cached_tokens, @user_id
      )`
    )
    .run({
      ...e,
      stream: e.stream ? 1 : 0,
      cached_tokens: e.cached_tokens ?? 0,
      user_id: e.user_id ?? null,
    });
}

function hourlyRows(): Array<Record<string, number | string>> {
  return getDb()
    .prepare("SELECT * FROM chat_stats_hourly ORDER BY hour_ts ASC")
    .all() as Array<Record<string, number | string>>;
}

describe("db/stats — pure helpers", () => {
  it("floorHourMs floors to the hour", () => {
    expect(floorHourMs(BASE + 123)).toBe(BASE);
    expect(floorHourMs(BASE + HOUR - 1)).toBe(BASE);
    expect(floorHourMs(BASE + HOUR)).toBe(BASE + HOUR);
  });

  it("latencyBucketIndex maps durations to 8 buckets", () => {
    expect(latencyBucketIndex(10)).toBe(0); // <=100
    expect(latencyBucketIndex(300)).toBe(2); // <=500
    expect(latencyBucketIndex(1500)).toBe(4); // <=2000
    expect(latencyBucketIndex(99999)).toBe(7); // >10000
  });
});

describe("db/stats — insertLog updates the hourly rollup", () => {
  it("accumulates requests/errors/tokens/last_ts within one hour bucket", () => {
    insertLog(entry({ ts: BASE, total_tokens: 12, prompt_tokens: 5, completion_tokens: 7 }));
    insertLog(entry({ ts: BASE + 60_000, total_tokens: 3, prompt_tokens: 1, completion_tokens: 2 }));
    insertLog(entry({ ts: BASE + 120_000, status_code: 500, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }));

    const rows = hourlyRows();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.hour_ts).toBe(BASE);
    expect(r.requests).toBe(3);
    expect(r.errors).toBe(1);
    expect(r.prompt_tokens).toBe(6);
    expect(r.completion_tokens).toBe(9);
    expect(r.total_tokens).toBe(15);
    expect(r.duration_count).toBe(3);
    expect(r.last_ts).toBe(BASE + 120_000);
    // All three durations are 10ms → bucket 0.
    expect(r.lat_b0).toBe(3);
  });

  it("splits different hours into separate rows", () => {
    insertLog(entry({ ts: BASE }));
    insertLog(entry({ ts: BASE + HOUR }));
    expect(hourlyRows()).toHaveLength(2);
  });
});

describe("db/stats — rollup-backed aggregates", () => {
  it("aggregateStats/ProviderHealth/Latency reflect recent inserts", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      insertLog(entry({ ts: now - i * 1000, duration_ms: 10, total_tokens: 2, prompt_tokens: 1, completion_tokens: 1 }));
    }
    insertLog(entry({ ts: now, status_code: 500, duration_ms: 10, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }));

    const stats = aggregateStats("24h");
    const row = stats.rows.find((r) => r.provider_id === "mimo" && r.upstream_model === "mimo-v2.5-pro");
    expect(row).toBeDefined();
    expect(row!.requests).toBe(6);
    expect(row!.errors).toBe(1);
    expect(row!.total_tokens).toBe(10);

    const health = aggregateProviderHealth(24 * HOUR);
    const h = health.find((x) => x.provider_id === "mimo");
    expect(h!.requests).toBe(6);
    expect(h!.errors).toBe(1);
    expect(h!.last_seen).toBeGreaterThan(0);

    const lat = aggregateLatency("24h");
    expect(lat.count).toBe(6);
    expect(lat.avg).toBe(10); // exact, from duration_sum/duration_count
    // All durations 10ms → bucket 0 → percentiles approximate to the bucket's
    // representative value (100ms upper bound).
    expect(lat.p50).toBe(100);
    expect(lat.p95).toBe(100);
  });

  it("aggregateMappings reads provider/client/upstream counts from the rollup", () => {
    const now = Date.now();
    insertLog(entry({ ts: now, client_model: "gpt-5", upstream_model: "mimo-v2.5-pro" }));
    insertLog(entry({ ts: now, client_model: "gpt-5", upstream_model: "mimo-v2.5-pro" }));
    insertLog(entry({ ts: now, client_model: "mimo-v2.5-pro", upstream_model: "mimo-v2.5-pro" }));
    const rows = aggregateMappings();
    const g = rows.find((r) => r.client_model === "gpt-5");
    expect(g!.count).toBe(2);
    expect(g!.upstream_model).toBe("mimo-v2.5-pro");
  });

  it("aggregateTokensTimeseries sums tokens per day from the rollup", () => {
    const now = Date.now();
    insertLog(entry({ ts: now, total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 }));
    insertLog(entry({ ts: now, total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 }));
    const ts = aggregateTokensTimeseries("7d", "day");
    const series = ts.series.find((s) => s.upstream_model === "mimo-v2.5-pro");
    expect(series).toBeDefined();
    expect(series!.total).toBe(150);
  });
});

describe("db/stats — chunked backfill of pre-existing logs", () => {
  it("backfills raw chat_logs into the rollup without double counting", () => {
    const now = Date.now();
    // 7 logs that "existed before the stats feature" (raw, no rollup).
    for (let i = 0; i < 7; i++) {
      rawInsertLog(entry({ ts: now - i * 1000, total_tokens: 2, prompt_tokens: 1, completion_tokens: 1, status_code: i === 0 ? 500 : 200 }));
    }
    // Rollup is still empty.
    expect(hourlyRows()).toHaveLength(0);

    // Simulate the upgrade boundary: snapshot the pre-existing max id.
    const maxId = (getDb().prepare("SELECT MAX(id) AS m FROM chat_logs").get() as { m: number }).m;
    setSetting("stats.backfillMaxId", String(maxId));
    setSetting("stats.backfillCursor", String(maxId));
    setSetting("stats.backfillDone", "0");

    // A NEW log arrives after the boundary → counted by the increment path.
    insertLog(entry({ ts: now, total_tokens: 2, prompt_tokens: 1, completion_tokens: 1 }));

    // Drain the backfill in small chunks.
    let guard = 0;
    while (!isStatsBackfillDone() && guard++ < 100) {
      backfillStatsChunk(3);
    }
    expect(isStatsBackfillDone()).toBe(true);

    // Total requests = 7 backfilled + 1 new = 8, errors = 1, each exactly once.
    const stats = aggregateStats("24h");
    const row = stats.rows.find((r) => r.provider_id === "mimo");
    expect(row!.requests).toBe(8);
    expect(row!.errors).toBe(1);
    expect(row!.total_tokens).toBe(16);
  });

  it("isStatsBackfillDone is true on a fresh empty database", () => {
    // openDb on an empty chat_logs → nothing to backfill.
    expect(isStatsBackfillDone()).toBe(true);
  });
});
