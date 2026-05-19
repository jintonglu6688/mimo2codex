// Master key resolution. Used to symmetrically encrypt BYOK upstream API keys
// and OAuth client secrets at rest. Resolution priority:
//
//   1. MIMO2CODEX_MASTER_KEY env var (base64 of exactly 32 bytes) — preferred
//      for production; the deployer owns the secret and it never touches disk
//      alongside the ciphertext.
//   2. <dataDir>/master.key (hex of 32 bytes) — auto-generated on first run
//      when env is absent. Convenience for personal/small-circle deployments
//      where co-locating the key with the DB is acceptable.
//
// If neither exists, a fresh 32-byte key is generated, written 0o600, and a
// warning is logged so the operator can promote it to env later.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

const KEY_BYTES = 32;
const KEY_FILE = "master.key";

export interface MasterKeyResult {
  key: Buffer;
  source: "env" | "file" | "generated";
}

let cached: MasterKeyResult | null = null;
let cachedFor: string | null = null;

export function loadMasterKey(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): MasterKeyResult {
  const cacheKey = `${dataDir}::${env.MIMO2CODEX_MASTER_KEY ?? ""}`;
  if (cached && cachedFor === cacheKey) return cached;

  const fromEnv = env.MIMO2CODEX_MASTER_KEY;
  if (fromEnv && fromEnv.trim()) {
    const buf = decodeEnvKey(fromEnv.trim());
    cached = { key: buf, source: "env" };
    cachedFor = cacheKey;
    return cached;
  }

  const path = join(dataDir, KEY_FILE);
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    const buf = decodeFileKey(raw);
    cached = { key: buf, source: "file" };
    cachedFor = cacheKey;
    return cached;
  }

  const fresh = randomBytes(KEY_BYTES);
  writeFileSync(path, fresh.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on Windows where chmod is largely a no-op.
  }
  log.warn(
    `[security] generated new master key at ${path}. ` +
      "For production, set MIMO2CODEX_MASTER_KEY (base64 of 32 bytes) instead — " +
      "otherwise losing this file means BYOK ciphertext becomes unrecoverable."
  );
  cached = { key: fresh, source: "generated" };
  cachedFor = cacheKey;
  return cached;
}

export function resetMasterKeyCache(): void {
  cached = null;
  cachedFor = null;
}

function decodeEnvKey(value: string): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    throw new Error("MIMO2CODEX_MASTER_KEY must be base64-encoded");
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `MIMO2CODEX_MASTER_KEY must decode to exactly ${KEY_BYTES} bytes; got ${buf.length}`
    );
  }
  return buf;
}

function decodeFileKey(raw: string): Buffer {
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `master.key must contain hex for exactly ${KEY_BYTES} bytes; got ${buf.length}`
    );
  }
  return buf;
}
