import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { closeDb, getDb, openDb } from "../src/db/index.js";
import {
  countUsers,
  createUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  listUsers,
  updateUser,
} from "../src/db/users.js";
import {
  createSession,
  deleteSessionByToken,
  findSessionByToken,
  pruneExpiredSessions,
  touchSession,
} from "../src/db/sessions.js";
import {
  createApiKey,
  findApiKeyByToken,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
} from "../src/db/apiKeys.js";
import {
  deleteUpstreamKey,
  getUpstreamKey,
  listUpstreamKeys,
  setUpstreamKey,
} from "../src/db/upstreamKeys.js";
import {
  consumeBootstrapToken,
  createBootstrapToken,
  findPendingByPurpose,
  parsePayload,
  peekBootstrapToken,
  pruneExpiredBootstrapTokens,
} from "../src/db/bootstrapTokens.js";

let dataDir: string;
const masterKey = randomBytes(32);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-auth-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("v4 migration: tables exist", () => {
  it("creates all 8 auth/user/codex-history/oauth tables", () => {
    const names = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const t of [
      "users",
      "user_sessions",
      "user_api_keys",
      "user_oauth_identities",
      "user_upstream_keys",
      "codex_config_history",
      "oauth_clients",
      "bootstrap_tokens",
    ]) {
      expect(names).toContain(t);
    }
  });
});

describe("users", () => {
  it("creates, queries, updates and deletes a user", () => {
    expect(countUsers()).toBe(0);
    const u = createUser({
      username: "alice",
      displayName: "Alice",
      passwordHash: "scrypt$x",
      isAdmin: true,
    });
    expect(u.is_admin).toBe(1);
    expect(countUsers()).toBe(1);

    expect(findUserById(u.id)?.username).toBe("alice");
    expect(findUserByUsername("alice")?.id).toBe(u.id);
    expect(findUserByUsername("missing")).toBeNull();

    updateUser(u.id, { displayName: "Alice Liddell", isAdmin: false, status: "disabled" });
    const after = findUserById(u.id)!;
    expect(after.display_name).toBe("Alice Liddell");
    expect(after.is_admin).toBe(0);
    expect(after.status).toBe("disabled");

    expect(listUsers().length).toBe(1);
    expect(deleteUser(u.id)).toBe(true);
    expect(countUsers()).toBe(0);
  });

  it("unique username constraint", () => {
    createUser({ username: "bob" });
    expect(() => createUser({ username: "bob" })).toThrow();
  });
});

describe("sessions", () => {
  it("creates and looks up a session by its bearer token", () => {
    const user = createUser({ username: "carol" });
    const { token, row } = createSession({ userId: user.id, ttlMs: 60_000 });
    expect(token.startsWith("m2cs_")).toBe(true);
    expect(row.expires_at).toBeGreaterThan(Date.now());

    const found = findSessionByToken(token);
    expect(found?.user.id).toBe(user.id);
    expect(found?.session.id).toBe(row.id);
  });

  it("returns null for expired sessions and prunes them", () => {
    const user = createUser({ username: "dave" });
    const { token } = createSession({ userId: user.id, ttlMs: 60_000 });
    const row = findSessionByToken(token);
    expect(row).not.toBeNull();
    // Force expiry by setting a negative TTL — slides expires_at into the past.
    touchSession(row!.session.id, -1_000);
    expect(findSessionByToken(token)).toBeNull();
    expect(pruneExpiredSessions()).toBeGreaterThanOrEqual(0);
  });

  it("returns null when the user has been disabled", () => {
    const user = createUser({ username: "eve" });
    const { token } = createSession({ userId: user.id, ttlMs: 60_000 });
    updateUser(user.id, { status: "disabled" });
    expect(findSessionByToken(token)).toBeNull();
  });

  it("deleteSessionByToken removes the session", () => {
    const user = createUser({ username: "frank" });
    const { token } = createSession({ userId: user.id });
    expect(findSessionByToken(token)).not.toBeNull();
    expect(deleteSessionByToken(token)).toBe(true);
    expect(findSessionByToken(token)).toBeNull();
  });

  it("rejects garbage and unknown tokens", () => {
    expect(findSessionByToken("")).toBeNull();
    expect(findSessionByToken("garbage")).toBeNull();
    expect(findSessionByToken("m2cs_doesnotexist")).toBeNull();
  });
});

describe("api keys (per-user bearer tokens)", () => {
  it("creates a key, surfaces plaintext once, looks it up, revokes it", () => {
    const user = createUser({ username: "grace" });
    const { token, row } = createApiKey(user.id, "laptop");
    expect(token.startsWith("m2c_")).toBe(true);
    expect(row.key_prefix.startsWith("m2c_")).toBe(true);
    expect(row.key_prefix.length).toBe(12);

    const found = findApiKeyByToken(token);
    expect(found?.user.id).toBe(user.id);
    expect(found?.apiKey.id).toBe(row.id);

    expect(listApiKeys(user.id).length).toBe(1);
    expect(revokeApiKey(user.id, row.id)).toBe(true);
    expect(findApiKeyByToken(token)).toBeNull();
  });

  it("touchApiKey updates last_used_at", () => {
    const user = createUser({ username: "harry" });
    const { row } = createApiKey(user.id, "cli");
    expect(row.last_used_at).toBeNull();
    touchApiKey(row.id);
    const after = listApiKeys(user.id)[0];
    expect(after.last_used_at).not.toBeNull();
  });

  it("does not match a non-m2c_ token", () => {
    const user = createUser({ username: "iris" });
    createApiKey(user.id, "x");
    expect(findApiKeyByToken("not-an-m2c-key")).toBeNull();
  });

  it("does not return revoked keys via findApiKeyByToken", () => {
    const user = createUser({ username: "jane" });
    const { token, row } = createApiKey(user.id, "x");
    expect(findApiKeyByToken(token)).not.toBeNull();
    revokeApiKey(user.id, row.id);
    expect(findApiKeyByToken(token)).toBeNull();
  });
});

describe("upstream keys (BYOK, encrypted)", () => {
  it("round-trips a per-user upstream API key through encryption", () => {
    const user = createUser({ username: "kim" });
    setUpstreamKey(user.id, "mimo", "sk-mimo-supersecret", masterKey);
    expect(getUpstreamKey(user.id, "mimo", masterKey)).toBe("sk-mimo-supersecret");
  });

  it("returns null for users with no BYOK entry", () => {
    const user = createUser({ username: "leo" });
    expect(getUpstreamKey(user.id, "mimo", masterKey)).toBeNull();
  });

  it("upsert: re-setting the same (user, provider) replaces the ciphertext", () => {
    const user = createUser({ username: "mia" });
    setUpstreamKey(user.id, "deepseek", "old", masterKey);
    setUpstreamKey(user.id, "deepseek", "new", masterKey);
    expect(getUpstreamKey(user.id, "deepseek", masterKey)).toBe("new");
    expect(listUpstreamKeys(user.id).length).toBe(1);
  });

  it("returns null (not 500) when decrypting under a wrong master key", () => {
    const user = createUser({ username: "nora" });
    setUpstreamKey(user.id, "mimo", "secret", masterKey);
    const wrong = randomBytes(32);
    expect(getUpstreamKey(user.id, "mimo", wrong)).toBeNull();
  });

  it("listUpstreamKeys returns metadata but no ciphertext or plaintext", () => {
    const user = createUser({ username: "olly" });
    setUpstreamKey(user.id, "mimo", "secret", masterKey);
    const summary = listUpstreamKeys(user.id);
    expect(summary[0].provider_id).toBe("mimo");
    expect((summary[0] as Record<string, unknown>).ciphertext).toBeUndefined();
  });

  it("deleteUpstreamKey removes the row", () => {
    const user = createUser({ username: "pia" });
    setUpstreamKey(user.id, "mimo", "x", masterKey);
    expect(deleteUpstreamKey(user.id, "mimo")).toBe(true);
    expect(listUpstreamKeys(user.id).length).toBe(0);
  });

  it("cascades on user delete", () => {
    const user = createUser({ username: "quinn" });
    setUpstreamKey(user.id, "mimo", "x", masterKey);
    deleteUser(user.id);
    expect(listUpstreamKeys(user.id).length).toBe(0);
  });
});

describe("bootstrap tokens (single-use, multi-purpose)", () => {
  it("create + peek + consume happy path", () => {
    const { token, row } = createBootstrapToken({
      purpose: "bootstrap",
      ttlMs: 60_000,
      payload: { hint: "first run" },
    });
    expect(token.startsWith("m2cb_")).toBe(true);
    expect(row.used_at).toBeNull();

    const peeked = peekBootstrapToken(token, "bootstrap");
    expect(peeked?.id).toBe(row.id);
    expect(parsePayload(peeked!)).toEqual({ hint: "first run" });

    const consumed = consumeBootstrapToken(token, "bootstrap");
    expect(consumed?.used_at).not.toBeNull();
    // Second consume: rejected.
    expect(consumeBootstrapToken(token, "bootstrap")).toBeNull();
    expect(peekBootstrapToken(token, "bootstrap")).toBeNull();
  });

  it("purpose mismatch is rejected", () => {
    const { token } = createBootstrapToken({ purpose: "invite", ttlMs: 60_000 });
    expect(peekBootstrapToken(token, "bootstrap")).toBeNull();
    expect(consumeBootstrapToken(token, "bootstrap")).toBeNull();
    // Right purpose works.
    expect(peekBootstrapToken(token, "invite")).not.toBeNull();
  });

  it("expired tokens are rejected and prunable", () => {
    const { token } = createBootstrapToken({ purpose: "oauth_state", ttlMs: -1 });
    expect(peekBootstrapToken(token, "oauth_state")).toBeNull();
    expect(consumeBootstrapToken(token, "oauth_state")).toBeNull();
    expect(pruneExpiredBootstrapTokens()).toBeGreaterThanOrEqual(1);
  });

  it("findPendingByPurpose returns only valid unused tokens", () => {
    createBootstrapToken({ purpose: "invite", ttlMs: 60_000 });
    const { token } = createBootstrapToken({ purpose: "invite", ttlMs: 60_000 });
    consumeBootstrapToken(token, "invite");
    const pending = findPendingByPurpose("invite");
    expect(pending.length).toBe(1);
    expect(pending[0].used_at).toBeNull();
  });
});
