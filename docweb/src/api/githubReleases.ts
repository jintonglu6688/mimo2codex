// Client for GitHub's public Releases API. Listing is cached in
// sessionStorage for 5 minutes to stay under the 60 req/h unauthenticated
// rate limit (the same browser hitting the page on every navigation would
// otherwise blow it on a few refreshes).

const REPO = "7as0nch/mimo2codex";
const CACHE_KEY = "m2c-desktop-releases-v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface DesktopAsset {
  name: string;           // e.g. "mimo2codex-desktop-0.4.5-win-x64.exe"
  size: number;           // bytes
  downloadUrl: string;
  platform: "win" | "mac";
  arch: "x64" | "arm64";
  ext: "exe" | "dmg" | "zip";
  /** Parsed out of the release body's SHA256 table if present. */
  sha256?: string;
}

export interface DesktopRelease {
  version: string;        // "0.4.5"
  tagName: string;        // "v0.4.5-desktop"
  publishedAt: string;    // ISO
  htmlUrl: string;
  body: string;
  assets: DesktopAsset[];
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  body: string;
  assets: GithubAsset[];
}

const DESKTOP_TAG_RE = /^v(\d+\.\d+\.\d+)-desktop(?:\.\d+)?$/;

function classifyAsset(name: string): { platform: "win" | "mac"; arch: "x64" | "arm64"; ext: "exe" | "dmg" | "zip" } | null {
  // mimo2codex-desktop-<version>-<plat>-<arch>.<ext>
  // <plat>  = win | mac
  // <arch>  = x64 | arm64
  // <ext>   = exe | dmg | zip
  const m = /-(win|mac)-(x64|arm64)\.(exe|dmg|zip)$/.exec(name);
  if (!m) return null;
  return {
    platform: m[1] as "win" | "mac",
    arch: m[2] as "x64" | "arm64",
    ext: m[3] as "exe" | "dmg" | "zip",
  };
}

/** Parse SHA256SUMS-style lines or a markdown table from the release body. */
function extractSha256(body: string, fileName: string): string | undefined {
  // Strategy A: line `<sha>  <filename>` (sha256sum output)
  const lineRe = new RegExp(`([0-9a-f]{64})\\s+${fileName.replace(/[.+*?^$()|[\]\\]/g, "\\$&")}`, "i");
  const lineMatch = lineRe.exec(body);
  if (lineMatch) return lineMatch[1];
  // Strategy B: markdown table cell `\`<sha>\`` near the filename
  const cellRe = new RegExp(`\`${fileName.replace(/[.+*?^$()|[\]\\]/g, "\\$&")}\`[^|]*\\|[^|]*\`([0-9a-f]{64})\``, "i");
  const cellMatch = cellRe.exec(body);
  if (cellMatch) return cellMatch[1];
  return undefined;
}

function adapt(raw: GithubRelease): DesktopRelease | null {
  const m = DESKTOP_TAG_RE.exec(raw.tag_name);
  if (!m || raw.draft) return null;
  const assets: DesktopAsset[] = [];
  for (const a of raw.assets) {
    const cls = classifyAsset(a.name);
    if (!cls) continue;
    assets.push({
      name: a.name,
      size: a.size,
      downloadUrl: a.browser_download_url,
      ...cls,
      sha256: extractSha256(raw.body ?? "", a.name),
    });
  }
  return {
    version: m[1],
    tagName: raw.tag_name,
    publishedAt: raw.published_at,
    htmlUrl: raw.html_url,
    body: raw.body ?? "",
    assets,
  };
}

interface CachedShape {
  fetchedAt: number;
  release: DesktopRelease | null;
}

export async function fetchLatestDesktopRelease(): Promise<DesktopRelease | null> {
  // Cache hit
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CachedShape;
      if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed.release;
    }
  } catch { /* sessionStorage may be unavailable */ }

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const list = (await res.json()) as GithubRelease[];
  const release = list.map(adapt).find((r): r is DesktopRelease => r !== null) ?? null;

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), release } satisfies CachedShape));
  } catch { /* ignore quota / disabled */ }

  return release;
}

export type DetectedPlatform = "win" | "mac" | "unknown";
export type DetectedArch = "x64" | "arm64" | "unknown";

/**
 * Best-effort platform/arch detection from User-Agent + Client Hints.
 *
 * Async because the only reliable way to learn the architecture on modern
 * browsers is `userAgentData.getHighEntropyValues(['architecture'])` —
 * the synchronous `userAgentData.architecture` is the *low-entropy hint*
 * and is usually empty.
 *
 * Mac-specific quirks:
 * - Safari deliberately freezes the UA string to "Intel Mac OS X" even on
 *   Apple Silicon (Apple's anti-fingerprinting policy). UA parsing alone
 *   cannot distinguish M-series from Intel on Safari.
 * - Chrome on Mac exposes the real arch via getHighEntropyValues.
 * - When neither source resolves, we default to arm64 on Mac: Apple stopped
 *   selling Intel Macs in 2022, so the population skew is heavily Apple
 *   Silicon by now. Users can override via the UI switcher.
 */
export async function detectPlatform(): Promise<{ platform: DetectedPlatform; arch: DetectedArch }> {
  const ua = navigator.userAgent;
  let platform: DetectedPlatform = "unknown";
  if (/Windows/i.test(ua)) platform = "win";
  else if (/Mac OS X|Macintosh/i.test(ua)) platform = "mac";

  let arch: DetectedArch = "unknown";

  // UA Client Hints — authoritative when available (Chromium ≥ 90 on Mac/Win).
  const uad = (navigator as unknown as {
    userAgentData?: {
      getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
    };
  }).userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const hi = await uad.getHighEntropyValues(["architecture", "bitness"]);
      if (hi.architecture === "arm") arch = "arm64";
      else if (hi.architecture === "x86") arch = "x64";
    } catch {
      // Permission denied / unsupported — fall through to heuristics below.
    }
  }

  // Heuristic fallbacks when UA-CH doesn't resolve arch.
  if (arch === "unknown") {
    if (platform === "mac") {
      // Safari & older browsers can't expose the chip. Default to arm64 since
      // Apple Silicon is now the dominant Mac config; user can switch in UI.
      arch = "arm64";
    } else if (platform === "win") {
      if (/ARM64|aarch64/i.test(ua)) arch = "arm64";
      else arch = "x64";
    }
  }

  return { platform, arch };
}
