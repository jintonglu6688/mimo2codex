// Step 3 verification: BYOK swaps the upstream API key only for the calling
// user, and only on providers the user has personally configured. Other paths
// (no user, no BYOK row, wrong provider, decryption failure) must fall back
// to the shared/global key without leaking the BYOK secret.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { resolveRuntimeForUser } from "../src/auth/byok.js";
import { createUser, type UserRow } from "../src/db/users.js";
import { setUpstreamKey } from "../src/db/upstreamKeys.js";
import { loadMasterKey, resetMasterKeyCache } from "../src/security/masterKey.js";
import type { Config } from "../src/config.js";
import type { ProviderRuntime } from "../src/providers/types.js";

let dataDir: string;
let cfg: Config;
let runtime: ProviderRuntime;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-byok-pipe-test-"));
  openDb(dataDir);
  resetMasterKeyCache();
  cfg = {
    host: "127.0.0.1",
    port: 0,
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "shared-mimo-key",
    exposeReasoning: true,
    verbose: false,
    userAgent: "mimo2codex/test",
    defaultProviderId: "mimo",
    providers: { mimo: null, deepseek: null },
    isTokenPlan: false,
    dataDir,
    adminEnabled: true,
    contextOverflowMode: "friendly",
    authMode: "on",
    cookieSecure: false,
  };
  runtime = {
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "shared-mimo-key",
    flags: { isTokenPlan: false },
  };
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  resetMasterKeyCache();
});

function userWithByok(providerId: string, plain: string): UserRow {
  const u = createUser({ username: `u-${Math.random().toString(36).slice(2, 8)}` });
  const { key } = loadMasterKey(dataDir);
  setUpstreamKey(u.id, providerId, plain, key);
  return u;
}

describe("resolveRuntimeForUser", () => {
  it("returns the shared runtime when user is null (local mode)", () => {
    const r = resolveRuntimeForUser(runtime, "mimo", null, cfg);
    expect(r.source).toBe("shared");
    expect(r.runtime.apiKey).toBe("shared-mimo-key");
  });

  it("returns the shared runtime when the user has no BYOK for this provider", () => {
    const u = createUser({ username: "no-byok" });
    const r = resolveRuntimeForUser(runtime, "mimo", u, cfg);
    expect(r.source).toBe("shared");
    expect(r.runtime.apiKey).toBe("shared-mimo-key");
  });

  it("swaps in the user's BYOK key when present for the same provider", () => {
    const u = userWithByok("mimo", "byok-mimo-secret");
    const r = resolveRuntimeForUser(runtime, "mimo", u, cfg);
    expect(r.source).toBe("byok");
    expect(r.runtime.apiKey).toBe("byok-mimo-secret");
    // Non-secret fields untouched.
    expect(r.runtime.baseUrl).toBe(runtime.baseUrl);
    expect(r.runtime.flags).toEqual(runtime.flags);
  });

  it("isolates BYOK per provider — mimo key is not used for deepseek", () => {
    const u = userWithByok("mimo", "byok-mimo");
    const r = resolveRuntimeForUser(runtime, "deepseek", u, cfg);
    expect(r.source).toBe("shared");
    expect(r.runtime.apiKey).toBe("shared-mimo-key");
  });

  it("isolates BYOK per user — user A's key is not used for user B", () => {
    const a = userWithByok("mimo", "user-a-key");
    const b = createUser({ username: "user-b" });
    const rA = resolveRuntimeForUser(runtime, "mimo", a, cfg);
    const rB = resolveRuntimeForUser(runtime, "mimo", b, cfg);
    expect(rA.runtime.apiKey).toBe("user-a-key");
    expect(rB.runtime.apiKey).toBe("shared-mimo-key");
  });

  it("falls back to shared when ciphertext cannot be decrypted (e.g., master key rotated)", () => {
    const u = userWithByok("mimo", "byok-key");
    // Simulate master-key rotation: clear cache + flip env to a new key, so
    // the next loadMasterKey() inside resolveRuntimeForUser picks up the new
    // value and decryption of the old ciphertext fails.
    const oldEnv = process.env.MIMO2CODEX_MASTER_KEY;
    process.env.MIMO2CODEX_MASTER_KEY = Buffer.alloc(32, 0x42).toString("base64");
    resetMasterKeyCache();
    try {
      const r = resolveRuntimeForUser(runtime, "mimo", u, cfg);
      expect(r.source).toBe("shared");
      expect(r.runtime.apiKey).toBe("shared-mimo-key");
    } finally {
      if (oldEnv === undefined) delete process.env.MIMO2CODEX_MASTER_KEY;
      else process.env.MIMO2CODEX_MASTER_KEY = oldEnv;
      resetMasterKeyCache();
    }
  });
});
