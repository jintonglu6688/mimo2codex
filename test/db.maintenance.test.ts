import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb, getDb } from "../src/db/index.js";
import {
  insertLog,
  deleteAllLogs,
  getDbSizeBytes,
  vacuumDb,
  diskFreeBytes,
} from "../src/db/logs.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-maint-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function seedLogs(n: number, bodyKb = 8): void {
  const body = "x".repeat(bodyKb * 1024);
  for (let i = 0; i < n; i++) {
    insertLog({
      ts: Date.now() - i * 1000,
      request_id: `req-${i}`,
      provider_id: "mimo",
      client_model: "m",
      upstream_model: "m",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 10,
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      stream: false,
      error_code: null,
      error_snippet: null,
      request_body: body,
      response_body: body,
      tool_call_count: null,
    });
  }
}

describe("db maintenance", () => {
  it("getDbSizeBytes returns a positive total = main + wal + shm", () => {
    const size = getDbSizeBytes();
    expect(size.total).toBeGreaterThan(0);
    expect(size.total).toBe(size.main + size.wal + size.shm);
  });

  it("deleteAllLogs removes every row and reports the count", () => {
    seedLogs(10);
    expect(deleteAllLogs()).toBe(10);
    expect(deleteAllLogs()).toBe(0);
  });

  it("vacuumDb reclaims space after a large delete", () => {
    seedLogs(300, 8); // ~9.6 MB of bodies (req+resp)
    getDb().pragma("wal_checkpoint(TRUNCATE)"); // flush WAL into the main file
    const full = getDbSizeBytes().total;
    deleteAllLogs();
    const res = vacuumDb();
    const compacted = getDbSizeBytes().total;
    expect(compacted).toBeLessThan(full); // space actually returned to the OS
    expect(res.afterBytes).toBeLessThanOrEqual(res.beforeBytes);
    expect(res.afterBytes).toBe(compacted);
  });

  it("diskFreeBytes returns a positive number for the data dir", () => {
    expect(diskFreeBytes(dataDir)).toBeGreaterThan(0);
  });
});
