// Hourly stats rollup (issue #76). The Dashboard used to aggregate over the
// whole chat_logs table on every load — fine at a few MB, catastrophic at the
// 22 GB this user reached (10+ minute page loads, and because better-sqlite3 is
// synchronous, those scans blocked the entire HTTP loop incl. the /v1 proxy).
//
// This module maintains a tiny `chat_stats_hourly` rollup keyed by
// (hour, provider, client_model, upstream_model): every insertLog increments
// the matching bucket (recordStatsForLog), and a one-time background pass
// (backfillStatsChunk) folds pre-existing rows in. The dashboard aggregates then
// read from the rollup (rows = hours × model-tuples ≈ thousands), independent of
// how large chat_logs grows.
//
// Kept in its own file so the write/backfill path is isolated; the read-side
// aggregate functions stay in logs.ts (same signatures) but query the rollup.

import { getDb } from "./index.js";
import { getSetting, setSetting } from "./settings.js";
import type { ChatLogEntry } from "./logs.js";

export const HOUR_MS = 3_600_000;

export function floorHourMs(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

// Upper bounds (ms) for the 8-bucket latency histogram. Bucket i counts
// durations <= LATENCY_BOUNDS[i]; index 7 is the open top bucket (> last bound).
const LATENCY_BOUNDS = [100, 250, 500, 1000, 2000, 5000, 10000];
// Value reported for a percentile that lands in each bucket (the bucket's upper
// edge; the open top bucket gets a nominal ">10s" figure). Percentiles are
// therefore approximate — exact average still comes from duration_sum/count.
export const LATENCY_REP_VALUES = [100, 250, 500, 1000, 2000, 5000, 10000, 15000];

export function latencyBucketIndex(durationMs: number): number {
  for (let i = 0; i < LATENCY_BOUNDS.length; i++) {
    if (durationMs <= LATENCY_BOUNDS[i]) return i;
  }
  return LATENCY_BOUNDS.length; // 7 — the open top bucket
}

// Approximate p50/p95/p99 from the 8 histogram bucket counts (b0..b7) and their
// total. Walks the cumulative distribution and returns the representative value
// of the bucket the quantile falls into.
export function percentilesFromBuckets(
  buckets: number[],
  count: number
): { p50: number; p95: number; p99: number } {
  if (count <= 0) return { p50: 0, p95: 0, p99: 0 };
  const at = (q: number): number => {
    const target = q * count;
    let cum = 0;
    for (let i = 0; i < buckets.length; i++) {
      cum += buckets[i];
      if (cum >= target) return LATENCY_REP_VALUES[i] ?? LATENCY_REP_VALUES[LATENCY_REP_VALUES.length - 1];
    }
    return LATENCY_REP_VALUES[LATENCY_REP_VALUES.length - 1];
  };
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

interface RawLogRow {
  ts: number;
  provider_id: string;
  client_model: string;
  upstream_model: string;
  status_code: number;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
}

const UPSERT_SQL = `
INSERT INTO chat_stats_hourly (
  hour_ts, provider_id, client_model, upstream_model,
  requests, errors, prompt_tokens, completion_tokens, total_tokens, cached_tokens,
  duration_sum, duration_count, last_ts,
  lat_b0, lat_b1, lat_b2, lat_b3, lat_b4, lat_b5, lat_b6, lat_b7
) VALUES (
  @hour_ts, @provider_id, @client_model, @upstream_model,
  1, @errors, @prompt_tokens, @completion_tokens, @total_tokens, @cached_tokens,
  @duration_sum, @duration_count, @last_ts,
  @b0, @b1, @b2, @b3, @b4, @b5, @b6, @b7
)
ON CONFLICT(hour_ts, provider_id, client_model, upstream_model) DO UPDATE SET
  requests = requests + 1,
  errors = errors + excluded.errors,
  prompt_tokens = prompt_tokens + excluded.prompt_tokens,
  completion_tokens = completion_tokens + excluded.completion_tokens,
  total_tokens = total_tokens + excluded.total_tokens,
  cached_tokens = cached_tokens + excluded.cached_tokens,
  duration_sum = duration_sum + excluded.duration_sum,
  duration_count = duration_count + excluded.duration_count,
  last_ts = MAX(last_ts, excluded.last_ts),
  lat_b0 = lat_b0 + excluded.lat_b0,
  lat_b1 = lat_b1 + excluded.lat_b1,
  lat_b2 = lat_b2 + excluded.lat_b2,
  lat_b3 = lat_b3 + excluded.lat_b3,
  lat_b4 = lat_b4 + excluded.lat_b4,
  lat_b5 = lat_b5 + excluded.lat_b5,
  lat_b6 = lat_b6 + excluded.lat_b6,
  lat_b7 = lat_b7 + excluded.lat_b7
`;

function upsertOne(row: RawLogRow): void {
  const hasDur = row.duration_ms != null;
  const dur = hasDur ? (row.duration_ms as number) : 0;
  const b = [0, 0, 0, 0, 0, 0, 0, 0];
  if (hasDur) b[latencyBucketIndex(dur)] = 1;
  getDb().prepare(UPSERT_SQL).run({
    hour_ts: floorHourMs(row.ts),
    provider_id: row.provider_id,
    client_model: row.client_model,
    upstream_model: row.upstream_model,
    errors: row.status_code >= 400 ? 1 : 0,
    prompt_tokens: row.prompt_tokens ?? 0,
    completion_tokens: row.completion_tokens ?? 0,
    total_tokens: row.total_tokens ?? 0,
    cached_tokens: row.cached_tokens ?? 0,
    duration_sum: dur,
    duration_count: hasDur ? 1 : 0,
    last_ts: row.ts,
    b0: b[0], b1: b[1], b2: b[2], b3: b[3],
    b4: b[4], b5: b[5], b6: b[6], b7: b[7],
  });
}

// Increment the hourly rollup for one freshly-inserted log. Called from within
// insertLog's transaction so the rollup never drifts from chat_logs.
export function recordStatsForLog(entry: ChatLogEntry): void {
  upsertOne({
    ts: entry.ts,
    provider_id: entry.provider_id,
    client_model: entry.client_model,
    upstream_model: entry.upstream_model,
    status_code: entry.status_code,
    duration_ms: entry.duration_ms,
    prompt_tokens: entry.prompt_tokens,
    completion_tokens: entry.completion_tokens,
    total_tokens: entry.total_tokens,
    cached_tokens: entry.cached_tokens ?? null,
  });
}

// ── Background backfill of pre-existing logs ──────────────────────────────
// The upgrade boundary (`stats.backfillMaxId`) is snapshotted in openDb the
// first time the v6 schema is live, BEFORE any new insert. New logs (id > maxId)
// are counted by recordStatsForLog; backfill folds in id <= maxId, so every
// chat_logs row is counted exactly once.

export function isStatsBackfillDone(): boolean {
  return getSetting("stats.backfillDone") === "1";
}

const BACKFILL_BATCH = 3000;

// Fold up to `batchSize` of the oldest-not-yet-processed pre-upgrade rows into
// the rollup, newest-first so recent (24h/7d) ranges become accurate first.
// Returns how many rows it processed and whether the backfill is now complete.
export function backfillStatsChunk(
  batchSize: number = BACKFILL_BATCH
): { processed: number; done: boolean } {
  if (isStatsBackfillDone()) return { processed: 0, done: true };
  const batch = Math.max(1, batchSize);
  const cursor = Number(getSetting("stats.backfillCursor") ?? "0");
  if (!Number.isFinite(cursor) || cursor < 1) {
    setSetting("stats.backfillDone", "1");
    return { processed: 0, done: true };
  }
  const rows = getDb()
    .prepare(
      `SELECT id, ts, provider_id, client_model, upstream_model, status_code, duration_ms,
              prompt_tokens, completion_tokens, total_tokens, cached_tokens
       FROM chat_logs WHERE id <= @cursor ORDER BY id DESC LIMIT @batch`
    )
    .all({ cursor, batch }) as Array<RawLogRow & { id: number }>;
  if (rows.length === 0) {
    setSetting("stats.backfillDone", "1");
    return { processed: 0, done: true };
  }
  let minId = cursor;
  const tx = getDb().transaction(() => {
    for (const r of rows) {
      upsertOne(r);
      minId = r.id;
    }
  });
  tx();
  const nextCursor = minId - 1;
  setSetting("stats.backfillCursor", String(nextCursor));
  const done = rows.length < batch || nextCursor < 1;
  if (done) setSetting("stats.backfillDone", "1");
  return { processed: rows.length, done };
}
