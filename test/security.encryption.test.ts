import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { decryptString, encryptString } from "../src/security/encryption.js";
import { loadMasterKey, resetMasterKeyCache } from "../src/security/masterKey.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-sec-test-"));
  resetMasterKeyCache();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  resetMasterKeyCache();
});

describe("encryption (AES-256-GCM)", () => {
  it("round-trips a string with a fresh key", () => {
    const key = randomBytes(32);
    const sealed = encryptString("sk-supersecret", key);
    expect(decryptString(sealed, key)).toBe("sk-supersecret");
  });

  it("produces unique nonces across encryptions of the same plaintext", () => {
    const key = randomBytes(32);
    const a = encryptString("same", key);
    const b = encryptString("same", key);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("decryption fails when ciphertext is tampered with", () => {
    const key = randomBytes(32);
    const sealed = encryptString("plaintext", key);
    // flip a bit by re-encoding with a single-character mutation
    const ctBytes = Buffer.from(sealed.ciphertext, "base64");
    ctBytes[0] = ctBytes[0] ^ 0x01;
    const corrupted = { ...sealed, ciphertext: ctBytes.toString("base64") };
    expect(() => decryptString(corrupted, key)).toThrow();
  });

  it("decryption fails when the auth tag is tampered with", () => {
    const key = randomBytes(32);
    const sealed = encryptString("plaintext", key);
    const tagBytes = Buffer.from(sealed.authTag, "base64");
    tagBytes[0] = tagBytes[0] ^ 0x01;
    const corrupted = { ...sealed, authTag: tagBytes.toString("base64") };
    expect(() => decryptString(corrupted, key)).toThrow();
  });

  it("decryption fails under a different key", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const sealed = encryptString("plaintext", a);
    expect(() => decryptString(sealed, b)).toThrow();
  });

  it("rejects non-32-byte keys", () => {
    expect(() => encryptString("x", randomBytes(16))).toThrow();
    const ok = encryptString("x", randomBytes(32));
    expect(() => decryptString(ok, randomBytes(16))).toThrow();
  });
});

describe("master key resolution", () => {
  it("prefers MIMO2CODEX_MASTER_KEY env over file", () => {
    const fromEnv = randomBytes(32);
    const result = loadMasterKey(dataDir, {
      MIMO2CODEX_MASTER_KEY: fromEnv.toString("base64"),
    });
    expect(result.source).toBe("env");
    expect(result.key.equals(fromEnv)).toBe(true);
    expect(existsSync(join(dataDir, "master.key"))).toBe(false);
  });

  it("falls back to <dataDir>/master.key when env is unset", () => {
    // First call generates the file.
    const gen = loadMasterKey(dataDir, {});
    expect(gen.source).toBe("generated");
    const path = join(dataDir, "master.key");
    expect(existsSync(path)).toBe(true);

    // Second call (fresh cache) reads it as 'file'.
    resetMasterKeyCache();
    const read = loadMasterKey(dataDir, {});
    expect(read.source).toBe("file");
    expect(read.key.equals(gen.key)).toBe(true);
  });

  it("rejects env values that don't decode to exactly 32 bytes", () => {
    expect(() =>
      loadMasterKey(dataDir, { MIMO2CODEX_MASTER_KEY: Buffer.alloc(16).toString("base64") })
    ).toThrow(/32 bytes/);
  });

  it("writes the generated file 0o600 on platforms that honor it", () => {
    loadMasterKey(dataDir, {});
    const path = join(dataDir, "master.key");
    const mode = statSync(path).mode & 0o777;
    // POSIX: should be 0o600. Windows: this assertion is loose because chmod
    // is a no-op there, so just ensure the file is non-empty and parseable.
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
    expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
  });

  it("caches per (dataDir, env-key) pair", () => {
    const k1 = loadMasterKey(dataDir, {}).key;
    // Same call returns same buffer (no new file generation).
    const k2 = loadMasterKey(dataDir, {}).key;
    expect(k1).toBe(k2);
  });
});
