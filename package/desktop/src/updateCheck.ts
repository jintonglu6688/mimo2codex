import { net } from "electron";
import { log } from "./logger.js";

// We list ALL releases (paginated; first page = 30 newest) and pick the
// newest one whose tag ends with "-desktop" (or "-desktop.N"). Using
// /releases/latest would surface CLI releases (v0.5.0) as if they were
// desktop updates — same repo, different distribution channel.
const RELEASES_URL = "https://api.github.com/repos/7as0nch/mimo2codex/releases?per_page=30";

const DESKTOP_TAG_RE = /^v\d+\.\d+\.\d+-desktop(?:\.\d+)?$/;

/** Returns the newest desktop release tag (e.g. "v0.5.0-desktop"), or null on any failure. */
export async function fetchLatestDesktopTag(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ method: "GET", url: RELEASES_URL });
    let body = "";
    req.on("response", (resp) => {
      resp.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      resp.on("end", () => {
        try {
          const json = JSON.parse(body) as Array<{ tag_name?: string; draft?: boolean; prerelease?: boolean }>;
          if (!Array.isArray(json)) { resolve(null); return; }
          // GitHub returns releases sorted by created_at desc; first match wins.
          // We deliberately accept prereleases (e.g. -desktop.1 RCs) so beta
          // testers see updates too. Drafts are filtered out.
          const found = json.find((r) =>
            !r.draft && typeof r.tag_name === "string" && DESKTOP_TAG_RE.test(r.tag_name)
          );
          resolve(found?.tag_name ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", (err) => { log.warn("update check failed", { error: err.message }); resolve(null); });
    req.end();
  });
}

/** Strips leading "v" and trailing "-desktop[.N]", returns [major, minor, patch] or null. */
export function parseDesktopVersion(tag: string): [number, number, number] | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)(?:-desktop(?:\.\d+)?)?$/.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True if `latest` is at least 1 minor ahead of `current`. */
export function isMinorAhead(current: [number, number, number], latest: [number, number, number]): boolean {
  if (latest[0] > current[0]) return true;
  if (latest[0] < current[0]) return false;
  return latest[1] - current[1] >= 1;
}
