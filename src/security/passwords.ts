// Password hashing via Node's built-in scrypt. Argon2id would be slightly
// stronger but requires a native build; scrypt is in-tree, well-vetted, and
// plenty for a ≤20-user private deployment. Stored format is a PHC-style
// string that encodes the parameters with the hash so we can bump cost in
// the future without breaking existing rows.
//
// Format: scrypt$N=<n>,r=<r>,p=<p>$<saltBase64>$<hashBase64>

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number }
) => Promise<Buffer>;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const DEFAULT_N = 16384; // ~16 MiB peak memory
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAX_MEM = 64 * 1024 * 1024; // 64 MiB ceiling

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(plain, salt, HASH_BYTES, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    maxmem: MAX_MEM,
  });
  return `scrypt$N=${DEFAULT_N},r=${DEFAULT_R},p=${DEFAULT_P}$${salt.toString(
    "base64"
  )}$${hash.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const params = parseParams(parts[1]);
  if (!params) return false;
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (expected.length !== HASH_BYTES) return false;
  const actual = await scryptAsync(plain, salt, expected.length, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: Math.max(MAX_MEM, 128 * params.N * params.r),
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function parseParams(s: string): { N: number; r: number; p: number } | null {
  const kv: Record<string, number> = {};
  for (const seg of s.split(",")) {
    const [k, v] = seg.split("=");
    const n = Number(v);
    if (!k || Number.isNaN(n)) return null;
    kv[k] = n;
  }
  if (!kv.N || !kv.r || !kv.p) return null;
  return { N: kv.N, r: kv.r, p: kv.p };
}
