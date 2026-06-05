import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectLegacyEnv, importLegacyEnv } from "../src/importLegacy.js";

// Each test gets a fresh fake home + fresh target data dir. Both live under
// tmpdir, so vitest's per-test isolation is preserved without monkey-patching
// `os.homedir`.
let fakeHome: string;
let targetDir: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "m2c-import-home-"));
  targetDir = mkdtempSync(join(tmpdir(), "m2c-import-target-"));
});

function seedLegacyEnv(contents: string): string {
  const dir = join(fakeHome, ".mimo2codex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ".env");
  writeFileSync(path, contents, "utf8");
  return path;
}

function writePointer(targetDir: string): void {
  writeFileSync(
    join(fakeHome, ".mimo2codex-pointer.json"),
    JSON.stringify({ dataDir: targetDir, updatedAt: Date.now() }),
    "utf8"
  );
}

describe("detectLegacyEnv", () => {
  it("returns null when there is no legacy install", () => {
    expect(detectLegacyEnv(targetDir, fakeHome)).toBeNull();
  });

  it("returns null when the legacy file exists but is empty", () => {
    seedLegacyEnv("# just a comment\n\n");
    expect(detectLegacyEnv(targetDir, fakeHome)).toBeNull();
  });

  it("returns null when the legacy file is the SAME location as the target", () => {
    // Edge case: user overrode the desktop data dir to point at ~/.mimo2codex.
    // We must NOT offer to "import from yourself".
    seedLegacyEnv("MIMO_API_KEY=sk-real\n");
    const sameDir = join(fakeHome, ".mimo2codex");
    expect(detectLegacyEnv(sameDir, fakeHome)).toBeNull();
  });

  it("follows the ~/.mimo2codex-pointer.json file when present (migrated install)", () => {
    // User migrated their CLI dataDir to D:\workspace\.mimo2codex via the
    // admin UI. Default ~/.mimo2codex/.env may still exist as a stale
    // leftover from the original install, but the AUTHORITATIVE config is
    // the one the pointer points at — we should detect THAT.
    const migrated = mkdtempSync(join(tmpdir(), "m2c-import-migrated-"));
    writeFileSync(join(migrated, ".env"), "MIMO_API_KEY=sk-migrated\n", "utf8");
    // Default location with DIFFERENT (stale) keys
    seedLegacyEnv("MIMO_API_KEY=sk-stale\n");
    writePointer(migrated);

    const probe = detectLegacyEnv(targetDir, fakeHome);
    expect(probe).not.toBeNull();
    expect(probe!.sourcePath).toBe(join(migrated, ".env"));
    expect(probe!.keys).toEqual(["MIMO_API_KEY"]);

    // And importLegacyEnv must read from the same pointer-resolved location
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(r.imported.MIMO_API_KEY).toBe("sk-migrated"); // not "sk-stale"
  });

  it("falls back to default ~/.mimo2codex when pointer points at a deleted dir", () => {
    // Stale pointer (user deleted the migrated dir but forgot to clean up).
    // We should fall back to the default location instead of giving up.
    writePointer(join(tmpdir(), "definitely-does-not-exist-" + Date.now()));
    seedLegacyEnv("MIMO_API_KEY=sk-default\n");
    const probe = detectLegacyEnv(targetDir, fakeHome);
    expect(probe).not.toBeNull();
    expect(probe!.sourcePath.endsWith(join(".mimo2codex", ".env"))).toBe(true);
  });

  it("falls back to default when pointer file is malformed", () => {
    writeFileSync(join(fakeHome, ".mimo2codex-pointer.json"), "not json", "utf8");
    seedLegacyEnv("MIMO_API_KEY=sk-default\n");
    const probe = detectLegacyEnv(targetDir, fakeHome);
    expect(probe).not.toBeNull();
    expect(probe!.sourcePath.endsWith(join(".mimo2codex", ".env"))).toBe(true);
  });

  it("returns the source path + ordered key list when keys are present", () => {
    seedLegacyEnv(
      [
        "DEEPSEEK_API_KEY=sk-ds",
        "MIMO_API_KEY=sk-mi",
        "MY_CUSTOM_VAR=hi",
        "MIMO_BASE_URL=https://example/v1",
        "",
      ].join("\n")
    );
    const probe = detectLegacyEnv(targetDir, fakeHome);
    expect(probe).not.toBeNull();
    expect(probe!.sourcePath.endsWith(join(".mimo2codex", ".env"))).toBe(true);
    // Known keys sorted alpha, then unknown keys sorted alpha
    expect(probe!.keys).toEqual([
      "DEEPSEEK_API_KEY",
      "MIMO_API_KEY",
      "MIMO_BASE_URL",
      "MY_CUSTOM_VAR",
    ]);
  });
});

describe("importLegacyEnv", () => {
  it("imports all keys when target is empty", () => {
    seedLegacyEnv("MIMO_API_KEY=sk-mi\nDEEPSEEK_API_KEY=sk-ds\nMIMO_BASE_URL=https://h/v1\n");
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(r.imported).toEqual({
      MIMO_API_KEY: "sk-mi",
      DEEPSEEK_API_KEY: "sk-ds",
      MIMO_BASE_URL: "https://h/v1",
    });
    expect(r.skipped).toEqual({});
    // And the file should actually be written
    const out = readFileSync(join(targetDir, ".env"), "utf8");
    expect(out).toMatch(/MIMO_API_KEY=sk-mi/);
    expect(out).toMatch(/DEEPSEEK_API_KEY=sk-ds/);
    expect(out).toMatch(/MIMO_BASE_URL=https:\/\/h\/v1/);
  });

  it("skips keys that are already present + usable in the target", () => {
    // Target already has MIMO_API_KEY set. Should be left alone.
    writeFileSync(join(targetDir, ".env"), "MIMO_API_KEY=sk-existing\n", "utf8");
    seedLegacyEnv("MIMO_API_KEY=sk-from-cli\nDEEPSEEK_API_KEY=sk-ds\n");
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(r.imported).toEqual({ DEEPSEEK_API_KEY: "sk-ds" });
    expect(r.skipped).toEqual({ MIMO_API_KEY: "sk-from-cli" });
    const out = readFileSync(join(targetDir, ".env"), "utf8");
    expect(out).toMatch(/MIMO_API_KEY=sk-existing/);
    expect(out).toMatch(/DEEPSEEK_API_KEY=sk-ds/);
  });

  it("treats placeholder-prefixed values in target as overwritable", () => {
    // sk-xxxxxxxxxxxxxxxxxxxx is hasUsableKey's "still a placeholder" signal —
    // the import flow should TREAT IT AS UNSET and overwrite, since the user
    // never typed a real key.
    writeFileSync(
      join(targetDir, ".env"),
      "MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx\n",
      "utf8"
    );
    seedLegacyEnv("MIMO_API_KEY=sk-real-cli\n");
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(r.imported).toEqual({ MIMO_API_KEY: "sk-real-cli" });
    expect(r.skipped).toEqual({});
  });

  it("returns empty imports when no legacy file exists", () => {
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(r.imported).toEqual({});
    expect(r.skipped).toEqual({});
  });

  it("ignores empty values in legacy (no-key lines)", () => {
    seedLegacyEnv("MIMO_API_KEY=sk-real\nEMPTY_VAR=\n");
    const r = importLegacyEnv(targetDir, fakeHome);
    expect(Object.keys(r.imported)).toEqual(["MIMO_API_KEY"]);
  });
});
