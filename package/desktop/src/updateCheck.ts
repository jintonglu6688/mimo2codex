import { net } from "electron";
import { log } from "./logger.js";

const RELEASES_URL = "https://api.github.com/repos/7as0nch/mimo2codex/releases/latest";

/** Returns the latest desktop release tag (e.g. "v0.5.0-desktop"), or null on any failure. */
export async function fetchLatestDesktopTag(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ method: "GET", url: RELEASES_URL });
    let body = "";
    req.on("response", (resp) => {
      resp.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      resp.on("end", () => {
        try {
          const json = JSON.parse(body) as { tag_name?: string };
          resolve(typeof json.tag_name === "string" ? json.tag_name : null);
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
