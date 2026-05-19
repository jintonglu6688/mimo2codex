import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/security/passwords.js";

describe("password hashing (scrypt)", () => {
  it("round-trips: a hashed password verifies against the same plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("password1");
    expect(await verifyPassword("password2", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("PASSWORD1", hash)).toBe(false);
  });

  it("produces a unique salt per hash (same plaintext yields different stored strings)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("returns false on malformed stored values rather than throwing", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "argon2id$bad")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$N=foo,r=bar,p=baz$x$y")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$$$$")).toBe(false);
  });
});
