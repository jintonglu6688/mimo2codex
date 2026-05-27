import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRuntime, saveRuntime, DEFAULT_RUNTIME } from "../src/runtime.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-runtime-"));
});

describe("loadRuntime", () => {
  it("returns DEFAULT_RUNTIME when file is missing", () => {
    expect(loadRuntime(dir)).toEqual(DEFAULT_RUNTIME);
  });

  it("merges persisted values over defaults", () => {
    writeFileSync(join(dir, "runtime.json"), JSON.stringify({ port: 9999 }));
    expect(loadRuntime(dir)).toEqual({ ...DEFAULT_RUNTIME, port: 9999 });
  });

  it("ignores corrupt JSON and returns defaults", () => {
    writeFileSync(join(dir, "runtime.json"), "{not json");
    expect(loadRuntime(dir)).toEqual(DEFAULT_RUNTIME);
  });
});

describe("saveRuntime", () => {
  it("writes pretty JSON", () => {
    saveRuntime(dir, { port: 8901, autostart: true });
    expect(existsSync(join(dir, "runtime.json"))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    expect(parsed).toEqual({ port: 8901, autostart: true });
  });

  it("strips ephemeral fields (launchedByAutostart) before writing", () => {
    saveRuntime(dir, { port: 8788, autostart: false, launchedByAutostart: true });
    const parsed = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    expect(parsed.launchedByAutostart).toBeUndefined();
  });
});
