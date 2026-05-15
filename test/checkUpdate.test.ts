import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  isPrerelease,
  fetchLatestVersion,
  getCachedStatus,
  refreshCacheInBackground,
  resolveStatus,
  isCacheFresh,
  readCache,
  writeCache,
  DEFAULT_TTL_MS,
} from "../src/util/checkUpdate.js";

describe("compareVersions", () => {
  it("orders main triplets numerically", () => {
    expect(compareVersions("0.2.9", "0.2.10")).toBe(-1);
    expect(compareVersions("0.3.0", "0.2.99")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("treats pre-release as less than the matching stable", () => {
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(-1);
    expect(compareVersions("0.3.0", "0.3.0-beta.1")).toBe(1);
  });
  it("orders pre-release identifiers per semver", () => {
    expect(compareVersions("0.3.0-beta.1", "0.3.0-beta.2")).toBe(-1);
    expect(compareVersions("0.3.0-beta.10", "0.3.0-beta.2")).toBe(1);
    expect(compareVersions("0.3.0-alpha", "0.3.0-beta")).toBe(-1);
  });
});

describe("isPrerelease", () => {
  it("returns true for hyphenated versions", () => {
    expect(isPrerelease("0.3.0-beta.0")).toBe(true);
    expect(isPrerelease("0.3.0")).toBe(false);
  });
});

describe("fetchLatestVersion", () => {
  it("returns the version string from a successful response", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 })
    ) as unknown as typeof fetch;
    const v = await fetchLatestVersion({ fetchImpl: fakeFetch });
    expect(v).toBe("1.2.3");
  });

  it("returns null on non-2xx response", async () => {
    const fakeFetch = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion({ fetchImpl: fakeFetch })).toBeNull();
  });

  it("returns null on malformed JSON / missing version field", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    ) as unknown as typeof fetch;
    expect(await fetchLatestVersion({ fetchImpl: fakeFetch })).toBeNull();
  });

  it("returns null when fetch throws (network / abort)", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchLatestVersion({ fetchImpl: fakeFetch })).toBeNull();
  });

  it("targets the beta dist-tag when channel=beta", async () => {
    let calledUrl: string | null = null;
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      calledUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify({ version: "0.3.0-beta.4" }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchLatestVersion({ fetchImpl: fakeFetch, channel: "beta" });
    expect(calledUrl).toMatch(/\/mimo2codex\/beta$/);
  });
});

describe("cache read/write", () => {
  function withTmpDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "mimo2codex-check-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("round-trips a cache entry", () => {
    withTmpDir((dir) => {
      writeCache(dir, { latestVersion: "1.0.0", checkedAt: 100, channel: "latest" });
      const back = readCache(dir);
      expect(back).toEqual({ latestVersion: "1.0.0", checkedAt: 100, channel: "latest" });
    });
  });

  it("returns null when cache file missing or malformed", () => {
    withTmpDir((dir) => {
      expect(readCache(dir)).toBeNull();
    });
  });
});

describe("isCacheFresh", () => {
  it("respects ttl", () => {
    const cache = { latestVersion: "1.0.0", checkedAt: 1000, channel: "latest" as const };
    expect(isCacheFresh(cache, 100, 1050)).toBe(true);
    expect(isCacheFresh(cache, 100, 1200)).toBe(false);
    expect(isCacheFresh(null, 100, 1200)).toBe(false);
  });
});

describe("getCachedStatus", () => {
  function withTmpDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "mimo2codex-status-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("flags hasUpdate when cache has a newer stable version", () => {
    withTmpDir((dir) => {
      writeCache(dir, { latestVersion: "0.3.0", checkedAt: Date.now(), channel: "latest" });
      const s = getCachedStatus({ currentVersion: "0.2.9", dataDir: dir });
      expect(s.hasUpdate).toBe(true);
      expect(s.latest).toBe("0.3.0");
      expect(s.channel).toBe("latest");
    });
  });

  it("does NOT flag hasUpdate when current is newer", () => {
    withTmpDir((dir) => {
      writeCache(dir, { latestVersion: "0.2.9", checkedAt: Date.now(), channel: "latest" });
      const s = getCachedStatus({ currentVersion: "0.3.0", dataDir: dir });
      expect(s.hasUpdate).toBe(false);
    });
  });

  it("uses beta channel when current is a pre-release", () => {
    withTmpDir((dir) => {
      writeCache(dir, { latestVersion: "0.3.0-beta.4", checkedAt: Date.now(), channel: "beta" });
      const s = getCachedStatus({ currentVersion: "0.3.0-beta.3", dataDir: dir });
      expect(s.channel).toBe("beta");
      expect(s.hasUpdate).toBe(true);
    });
  });

  it("ignores cache from a different channel", () => {
    withTmpDir((dir) => {
      writeCache(dir, { latestVersion: "0.3.0", checkedAt: Date.now(), channel: "latest" });
      // current is beta but only stable cache exists — don't suggest from stable
      const s = getCachedStatus({ currentVersion: "0.3.0-beta.3", dataDir: dir });
      expect(s.channel).toBe("beta");
      expect(s.latest).toBeNull();
      expect(s.hasUpdate).toBe(false);
    });
  });

  it("returns skipped when dataDir is null (--no-admin)", () => {
    const s = getCachedStatus({ currentVersion: "0.2.9", dataDir: null });
    expect(s.source).toBe("skipped");
    expect(s.hasUpdate).toBe(false);
  });
});

describe("resolveStatus", () => {
  function withTmpDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "mimo2codex-resolve-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("serves from cache when fresh", async () => {
    await withTmpDir(async (dir) => {
      writeCache(dir, { latestVersion: "0.3.0", checkedAt: Date.now() - 100, channel: "latest" });
      const fakeFetch = vi.fn() as unknown as typeof fetch;
      const s = await resolveStatus({
        currentVersion: "0.2.9",
        dataDir: dir,
        ttlMs: 60_000,
        fetchImpl: fakeFetch,
      });
      expect(s.latest).toBe("0.3.0");
      expect(s.source).toBe("cache");
      expect(fakeFetch).not.toHaveBeenCalled();
    });
  });

  it("refreshes when cache is stale", async () => {
    await withTmpDir(async (dir) => {
      writeCache(dir, { latestVersion: "0.2.9", checkedAt: 1, channel: "latest" });
      const fakeFetch = vi.fn(async () =>
        new Response(JSON.stringify({ version: "0.3.5" }), { status: 200 })
      ) as unknown as typeof fetch;
      const s = await resolveStatus({
        currentVersion: "0.2.9",
        dataDir: dir,
        ttlMs: 100,
        fetchImpl: fakeFetch,
      });
      expect(s.latest).toBe("0.3.5");
      expect(s.source).toBe("fresh");
      expect(fakeFetch).toHaveBeenCalledOnce();
      // cache should be persisted
      expect(readCache(dir)?.latestVersion).toBe("0.3.5");
    });
  });
});

describe("refreshCacheInBackground", () => {
  it("does not write cache when fetch returns null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mimo2codex-bg-"));
    try {
      const fakeFetch = vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch;
      const s = await refreshCacheInBackground({
        currentVersion: "0.2.9",
        dataDir: dir,
        fetchImpl: fakeFetch,
      });
      expect(s.latest).toBeNull();
      expect(readCache(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("DEFAULT_TTL_MS", () => {
  it("is 6 hours", () => {
    expect(DEFAULT_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
