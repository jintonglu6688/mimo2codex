import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// Compare two semver-ish strings. Returns -1 / 0 / 1.
// Tolerates pre-release suffixes ("0.3.0-beta.1"): pre-release sorts BEFORE the
// matching stable, per semver spec. Good enough for our use — we only compare
// against the npm registry's reported `latest`/`beta` dist-tag.
export function compareVersions(a: string, b: string): number {
  const parseParts = (s: string): { main: number[]; pre: string[] } => {
    const [mainStr, preStr] = s.split("-");
    const main = mainStr.split(".").map((x) => Number(x) || 0);
    const pre = preStr ? preStr.split(".") : [];
    return { main, pre };
  };
  const A = parseParts(a);
  const B = parseParts(b);
  const len = Math.max(A.main.length, B.main.length);
  for (let i = 0; i < len; i++) {
    const av = A.main[i] ?? 0;
    const bv = B.main[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  // main equal: stable > pre-release
  if (A.pre.length === 0 && B.pre.length > 0) return 1;
  if (A.pre.length > 0 && B.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const av = A.pre[i] ?? "";
    const bv = B.pre[i] ?? "";
    if (av === bv) continue;
    const aNum = /^\d+$/.test(av) ? Number(av) : null;
    const bNum = /^\d+$/.test(bv) ? Number(bv) : null;
    if (aNum !== null && bNum !== null) return aNum < bNum ? -1 : 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

export interface VersionCheckCache {
  latestVersion: string | null;
  checkedAt: number; // epoch ms
  // Tag we queried (latest / beta) — surfaces in /admin/api/update-status
  // for debugging and explains why an alpha user might see a beta as latest.
  channel: "latest" | "beta";
}

export function cacheFilePath(dataDir: string): string {
  return join(dataDir, "version-check.json");
}

export function readCache(dataDir: string): VersionCheckCache | null {
  const path = cacheFilePath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as VersionCheckCache;
    if (typeof parsed.checkedAt !== "number") return null;
    if (parsed.channel !== "latest" && parsed.channel !== "beta") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(dataDir: string, cache: VersionCheckCache): void {
  const path = cacheFilePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

export function isCacheFresh(
  cache: VersionCheckCache | null,
  ttlMs: number,
  now: number = Date.now()
): boolean {
  if (!cache) return false;
  return now - cache.checkedAt < ttlMs;
}

export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface FetchOptions {
  packageName?: string;
  channel?: "latest" | "beta";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Fetch the dist-tag from the npm registry. Returns null on any failure
// (timeout, DNS, non-2xx, malformed JSON) — version checks must never break
// startup, so callers treat null as "skip prompt this time".
export async function fetchLatestVersion(opts: FetchOptions = {}): Promise<string | null> {
  const packageName = opts.packageName ?? "mimo2codex";
  const channel = opts.channel ?? "latest";
  const timeoutMs = opts.timeoutMs ?? 5000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${channel}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (!data || typeof data.version !== "string") return null;
    return data.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveUpdateOptions {
  currentVersion: string;
  dataDir: string | null; // null when --no-admin (no caching)
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: number;
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  channel: "latest" | "beta";
  checkedAt: number | null;
  source: "cache" | "fresh" | "skipped";
}

// Returns the most authoritative cached status without hitting the network.
// Used for synchronous decisions (CLI startup prompt, GET /update-status).
export function getCachedStatus(opts: {
  currentVersion: string;
  dataDir: string | null;
}): UpdateStatus {
  const channel: "latest" | "beta" = isPrerelease(opts.currentVersion) ? "beta" : "latest";
  if (!opts.dataDir) {
    return {
      current: opts.currentVersion,
      latest: null,
      hasUpdate: false,
      channel,
      checkedAt: null,
      source: "skipped",
    };
  }
  const cache = readCache(opts.dataDir);
  if (!cache || cache.channel !== channel) {
    return {
      current: opts.currentVersion,
      latest: null,
      hasUpdate: false,
      channel,
      checkedAt: cache?.checkedAt ?? null,
      source: "cache",
    };
  }
  const hasUpdate = !!cache.latestVersion && compareVersions(cache.latestVersion, opts.currentVersion) > 0;
  return {
    current: opts.currentVersion,
    latest: cache.latestVersion,
    hasUpdate,
    channel,
    checkedAt: cache.checkedAt,
    source: "cache",
  };
}

// Fire-and-forget: refresh the cache from the network. Resolves with the new
// status. Callers in startup paths typically ignore the promise and let the
// next launch pick up the fresh value.
export async function refreshCacheInBackground(
  opts: ResolveUpdateOptions
): Promise<UpdateStatus> {
  const channel: "latest" | "beta" = isPrerelease(opts.currentVersion) ? "beta" : "latest";
  const latest = await fetchLatestVersion({ channel, fetchImpl: opts.fetchImpl });
  const now = opts.now ?? Date.now();
  if (opts.dataDir && latest) {
    writeCache(opts.dataDir, { latestVersion: latest, checkedAt: now, channel });
  }
  const hasUpdate = !!latest && compareVersions(latest, opts.currentVersion) > 0;
  return {
    current: opts.currentVersion,
    latest,
    hasUpdate,
    channel,
    checkedAt: now,
    source: "fresh",
  };
}

// One-shot resolve used by webui's "Check now" button: serve cache if fresh,
// otherwise hit the network and update cache.
export async function resolveStatus(opts: ResolveUpdateOptions): Promise<UpdateStatus> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cached = getCachedStatus({
    currentVersion: opts.currentVersion,
    dataDir: opts.dataDir,
  });
  if (cached.checkedAt !== null && isCacheFresh(
    { latestVersion: cached.latest, checkedAt: cached.checkedAt, channel: cached.channel },
    ttlMs,
    opts.now
  )) {
    return cached;
  }
  return refreshCacheInBackground(opts);
}
