import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { closeDb, openDb } from "../src/db/index.js";
import { createUser, deleteUser } from "../src/db/users.js";
import {
  deleteOAuthClient,
  getOAuthClientRow,
  getOAuthClientSecret,
  listOAuthClients,
  upsertOAuthClient,
} from "../src/db/oauthClients.js";
import {
  findIdentity,
  linkOAuthIdentity,
  listIdentitiesForUser,
  unlinkIdentity,
} from "../src/db/oauthIdentities.js";

let dataDir: string;
const masterKey = randomBytes(32);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-oauth-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("oauth_clients (encrypted secret at rest)", () => {
  it("upsert + decrypt round trip", () => {
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "client-123",
        clientSecret: "shhh",
        callbackUrl: "https://x.example/oauth/callback/github",
        enabled: true,
      },
      masterKey
    );
    const got = getOAuthClientSecret("github", masterKey);
    expect(got?.clientId).toBe("client-123");
    expect(got?.clientSecret).toBe("shhh");
    expect(got?.enabled).toBe(true);
  });

  it("listOAuthClients exposes metadata but never the secret", () => {
    upsertOAuthClient(
      {
        provider: "gitee",
        clientId: "g-1",
        clientSecret: "g-secret",
        callbackUrl: "https://x.example/oauth/callback/gitee",
        enabled: true,
      },
      masterKey
    );
    const list = listOAuthClients();
    expect(list[0].provider).toBe("gitee");
    expect(list[0].has_secret).toBe(true);
    expect((list[0] as Record<string, unknown>).client_secret_ciphertext).toBeUndefined();
  });

  it("upsert with clientSecret = null preserves the existing secret", () => {
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "c1",
        clientSecret: "first",
        callbackUrl: "https://x/cb",
        enabled: false,
      },
      masterKey
    );
    upsertOAuthClient(
      {
        provider: "github",
        clientId: "c1-renamed",
        clientSecret: null,
        callbackUrl: "https://x/cb2",
        enabled: true,
      },
      masterKey
    );
    const got = getOAuthClientSecret("github", masterKey);
    expect(got?.clientId).toBe("c1-renamed");
    expect(got?.clientSecret).toBe("first");
    expect(got?.callbackUrl).toBe("https://x/cb2");
    expect(got?.enabled).toBe(true);
  });

  it("creating without a secret on first write fails loudly", () => {
    expect(() =>
      upsertOAuthClient(
        {
          provider: "github",
          clientId: "c",
          clientSecret: null,
          callbackUrl: "u",
          enabled: false,
        },
        masterKey
      )
    ).toThrow();
  });

  it("delete removes the row", () => {
    upsertOAuthClient(
      { provider: "github", clientId: "x", clientSecret: "y", callbackUrl: "u", enabled: false },
      masterKey
    );
    expect(deleteOAuthClient("github")).toBe(true);
    expect(getOAuthClientRow("github")).toBeNull();
  });
});

describe("user_oauth_identities", () => {
  it("links and looks up a provider identity", () => {
    const u = createUser({ username: "alice" });
    linkOAuthIdentity({
      userId: u.id,
      provider: "github",
      providerUserId: "42",
      providerUsername: "alice-gh",
      avatarUrl: "https://x/avatar.png",
    });
    const found = findIdentity("github", "42");
    expect(found?.user_id).toBe(u.id);
    expect(found?.provider_username).toBe("alice-gh");
  });

  it("re-linking the same (provider, providerUserId) updates instead of duplicates", () => {
    const a = createUser({ username: "a" });
    const b = createUser({ username: "b" });
    linkOAuthIdentity({ userId: a.id, provider: "gitee", providerUserId: "1" });
    linkOAuthIdentity({ userId: b.id, provider: "gitee", providerUserId: "1" });
    expect(findIdentity("gitee", "1")?.user_id).toBe(b.id);
    expect(listIdentitiesForUser(a.id).length).toBe(0);
  });

  it("unlink removes the row", () => {
    const u = createUser({ username: "alice" });
    linkOAuthIdentity({ userId: u.id, provider: "github", providerUserId: "1" });
    expect(unlinkIdentity(u.id, "github")).toBe(true);
    expect(findIdentity("github", "1")).toBeNull();
  });

  it("cascades on user delete", () => {
    const u = createUser({ username: "alice" });
    linkOAuthIdentity({ userId: u.id, provider: "github", providerUserId: "1" });
    deleteUser(u.id);
    expect(findIdentity("github", "1")).toBeNull();
  });
});
