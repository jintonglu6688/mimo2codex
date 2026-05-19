// AES-256-GCM symmetric encryption for at-rest secrets (BYOK upstream API
// keys, OAuth client_secret). Nonce is 12 random bytes per encryption — the
// GCM standard. Auth tag is stored separately so tampering with the ciphertext
// produces an integrity failure at decrypt time.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;

export interface SealedSecret {
  ciphertext: string; // base64
  nonce: string;      // base64
  authTag: string;    // base64
}

export function encryptString(plaintext: string, key: Buffer): SealedSecret {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

export function decryptString(sealed: SealedSecret, key: Buffer): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const nonce = Buffer.from(sealed.nonce, "base64");
  const tag = Buffer.from(sealed.authTag, "base64");
  const ct = Buffer.from(sealed.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}
