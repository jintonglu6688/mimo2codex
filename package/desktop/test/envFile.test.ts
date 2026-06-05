import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEnv, writeEnv, hasUsableKey } from "../src/envFile.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-env-"));
});

describe("readEnv", () => {
  it("returns empty object when .env is missing", () => {
    expect(readEnv(dir)).toEqual({});
  });
  it("parses KEY=value lines, ignoring comments and blanks", () => {
    writeFileSync(join(dir, ".env"), "# comment\n\nMIMO_API_KEY=sk-real\nPORT=9000\n");
    expect(readEnv(dir)).toEqual({ MIMO_API_KEY: "sk-real", PORT: "9000" });
  });
  it("strips surrounding quotes", () => {
    writeFileSync(join(dir, ".env"), `MIMO_API_KEY="sk-quoted"\nFOO='single'\n`);
    expect(readEnv(dir)).toEqual({ MIMO_API_KEY: "sk-quoted", FOO: "single" });
  });
});

describe("writeEnv", () => {
  it("upserts keys, preserving existing comments + ordering", () => {
    writeFileSync(join(dir, ".env"), "# header\nMIMO_API_KEY=old\nOTHER=keep\n");
    writeEnv(dir, { MIMO_API_KEY: "new", PORT: "8788" });
    const out = readFileSync(join(dir, ".env"), "utf8");
    expect(out).toMatch(/# header/);
    expect(out).toMatch(/MIMO_API_KEY=new/);
    expect(out).toMatch(/OTHER=keep/);
    expect(out).toMatch(/PORT=8788/);
  });
  it("creates file when missing", () => {
    writeEnv(dir, { MIMO_API_KEY: "sk-1" });
    expect(existsSync(join(dir, ".env"))).toBe(true);
  });
});

describe("hasUsableKey", () => {
  it("returns false for missing key", () => {
    expect(hasUsableKey({}, "MIMO_API_KEY")).toBe(false);
  });
  it("returns false for empty key", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "" }, "MIMO_API_KEY")).toBe(false);
  });
  it("returns false for template placeholder", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx" }, "MIMO_API_KEY")).toBe(false);
  });
  it("returns true for a real-looking key", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "sk-abc123def456" }, "MIMO_API_KEY")).toBe(true);
  });
});
