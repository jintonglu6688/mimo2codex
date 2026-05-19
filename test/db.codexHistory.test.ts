import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { createUser } from "../src/db/users.js";
import {
  appendCodexHistory,
  deleteCodexHistory,
  getCodexHistoryById,
  hasInitialHistory,
  listCodexHistory,
} from "../src/db/codexHistory.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-codexhist-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function payload(seq: number) {
  return {
    authJson: JSON.stringify({ OPENAI_API_KEY: `tok-${seq}` }),
    configToml: `# config ${seq}\n[model_providers.mimo]\nbase_url="http://x:${seq}"\n`,
  };
}

describe("codex_config_history", () => {
  it("appends an initial snapshot and detects it", () => {
    const u = createUser({ username: "a" });
    expect(hasInitialHistory(u.id)).toBe(false);
    appendCodexHistory({ userId: u.id, kind: "initial", ...payload(0) });
    expect(hasInitialHistory(u.id)).toBe(true);
  });

  it("retention: keeps the earliest 'initial' + the most recent 10 non-initial", () => {
    const u = createUser({ username: "b" });
    appendCodexHistory({ userId: u.id, kind: "initial", ...payload(0) });
    // 15 applies → 10 retained + 1 initial = 11 total
    for (let i = 1; i <= 15; i++) {
      appendCodexHistory({ userId: u.id, kind: "apply", ...payload(i), note: `apply ${i}` });
    }
    const rows = listCodexHistory(u.id, 100);
    expect(rows.length).toBe(11);
    expect(rows.filter((r) => r.kind === "initial").length).toBe(1);
    const notes = rows.filter((r) => r.kind === "apply").map((r) => r.note);
    // Oldest five (applies 1-5) should be gone; keep applies 6-15.
    for (const dropped of ["apply 1", "apply 2", "apply 3", "apply 4", "apply 5"]) {
      expect(notes).not.toContain(dropped);
    }
    for (const kept of ["apply 6", "apply 11", "apply 15"]) {
      expect(notes).toContain(kept);
    }
  });

  it("restore entries count toward the retention window (they are non-initial)", () => {
    const u = createUser({ username: "c" });
    appendCodexHistory({ userId: u.id, kind: "initial", ...payload(0) });
    for (let i = 1; i <= 9; i++) {
      appendCodexHistory({ userId: u.id, kind: "apply", ...payload(i) });
    }
    appendCodexHistory({ userId: u.id, kind: "restore", ...payload(99), note: "rollback" });
    appendCodexHistory({ userId: u.id, kind: "apply", ...payload(100) });
    const rows = listCodexHistory(u.id, 100);
    expect(rows.length).toBe(11); // 1 initial + 10 most recent non-initial
    // The 'restore' should still be present (it's within the last 10).
    expect(rows.find((r) => r.kind === "restore")).toBeDefined();
  });

  it("local mode (user_id = null) has its own timeline", () => {
    const u = createUser({ username: "d" });
    appendCodexHistory({ userId: null, kind: "initial", ...payload(0) });
    appendCodexHistory({ userId: null, kind: "apply", ...payload(1) });
    appendCodexHistory({ userId: u.id, kind: "initial", ...payload(2) });

    expect(listCodexHistory(null).length).toBe(2);
    expect(listCodexHistory(u.id).length).toBe(1);
    expect(hasInitialHistory(null)).toBe(true);
    expect(hasInitialHistory(u.id)).toBe(true);
  });

  it("deleteCodexHistory refuses to drop 'initial' but allows other kinds", () => {
    const u = createUser({ username: "e" });
    const init = appendCodexHistory({ userId: u.id, kind: "initial", ...payload(0) });
    const appl = appendCodexHistory({ userId: u.id, kind: "apply", ...payload(1) });
    expect(deleteCodexHistory(init.id, u.id)).toBe(false);
    expect(getCodexHistoryById(init.id)).not.toBeNull();
    expect(deleteCodexHistory(appl.id, u.id)).toBe(true);
    expect(getCodexHistoryById(appl.id)).toBeNull();
  });
});
