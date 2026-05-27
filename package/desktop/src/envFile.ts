import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { KEY_PLACEHOLDER_PREFIX } from "../shared/types.js";

const FILE = ".env";

export function readEnv(userDataDir: string): Record<string, string> {
  const path = join(userDataDir, FILE);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function writeEnv(userDataDir: string, updates: Record<string, string>): void {
  mkdirSync(userDataDir, { recursive: true });
  const path = join(userDataDir, FILE);
  const existingLines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const seen = new Set<string>();
  const outLines: string[] = [];
  for (const rawLine of existingLines) {
    const line = rawLine;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      outLines.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      outLines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      outLines.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      outLines.push(line);
    }
  }
  // Append any updates not yet seen
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) outLines.push(`${k}=${v}`);
  }
  // Trim trailing blank duplicates, then ensure exactly one trailing newline
  while (outLines.length > 0 && outLines[outLines.length - 1] === "") outLines.pop();
  writeFileSync(path, outLines.join("\n") + "\n", "utf8");
}

export function hasUsableKey(env: Record<string, string>, key: string): boolean {
  const v = env[key];
  if (!v) return false;
  if (v.startsWith(KEY_PLACEHOLDER_PREFIX)) return false;
  return true;
}
