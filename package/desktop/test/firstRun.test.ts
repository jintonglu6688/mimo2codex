import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { needsFirstRunSetup } from "../src/firstRun.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-fr-"));
});

describe("needsFirstRunSetup", () => {
  it("true when no .env file exists", () => {
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("true when .env exists but no provider key is set", () => {
    writeFileSync(join(dir, ".env"), "PORT=8788\n");
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("true when key is the template placeholder", () => {
    writeFileSync(join(dir, ".env"), "MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx\n");
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("false when any provider has a usable key", () => {
    writeFileSync(join(dir, ".env"), "DEEPSEEK_API_KEY=sk-realkey-here\n");
    expect(needsFirstRunSetup(dir)).toBe(false);
  });
});
