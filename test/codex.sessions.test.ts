import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let originalCodexHome: string | undefined;

function codexDir(): string {
  return path.join(fakeHome, ".codex");
}

// Build a minimal state_<n>.sqlite with the columns sessions.ts reads.
function seedStateDb(n: number, rows: Array<Record<string, unknown>>): string {
  mkdirSync(codexDir(), { recursive: true });
  const p = path.join(codexDir(), `state_${n}.sqlite`);
  const db = new Database(p);
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    first_user_message TEXT NOT NULL DEFAULT ''
  )`);
  const stmt = db.prepare(
    `INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, archived, tokens_used, first_user_message)
     VALUES (@id, @rollout_path, @created_at, @updated_at, @source, @model_provider, @cwd, @title, @archived, @tokens_used, @first_user_message)`
  );
  for (const r of rows) {
    stmt.run({
      source: "vscode",
      title: "",
      archived: 0,
      tokens_used: 0,
      first_user_message: "",
      ...r,
    });
  }
  db.close();
  return p;
}

function seedRollout(name: string, provider: string): string {
  const dir = path.join(codexDir(), "sessions", "2026", "03", "10");
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  const meta = { timestamp: "x", type: "session_meta", payload: { id: "abc", model_provider: provider, cwd: "D:/proj" } };
  writeFileSync(p, JSON.stringify(meta) + "\n" + JSON.stringify({ type: "event", payload: {} }) + "\n", "utf-8");
  return p;
}

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-sessions-test-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  originalCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  homedirSpy.mockRestore();
  if (originalCodexHome !== undefined) process.env.CODEX_HOME = originalCodexHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function load() {
  return import("../src/codex/sessions.js");
}

describe("codex/sessions", () => {
  it("returns unavailable when no state db exists", async () => {
    const { listCodexSessions, findStateDb } = await load();
    expect(findStateDb()).toBeNull();
    const r = listCodexSessions();
    expect(r.available).toBe(false);
    expect(r.sessions).toHaveLength(0);
  });

  it("findStateDb picks the highest-numbered state db", async () => {
    seedStateDb(5, []);
    seedStateDb(6, []);
    const { findStateDb } = await load();
    expect(findStateDb()).toBe(path.join(codexDir(), "state_6.sqlite"));
  });

  it("lists sessions and dedupes providers", async () => {
    seedStateDb(5, [
      { id: "s1", rollout_path: "r1", created_at: 1, updated_at: 30, model_provider: "openai", cwd: "D:/a", title: "First" },
      { id: "s2", rollout_path: "r2", created_at: 2, updated_at: 40, model_provider: "mimo", cwd: "D:/a", title: "Second" },
      { id: "s3", rollout_path: "r3", created_at: 3, updated_at: 20, model_provider: "openai", cwd: "D:/b", title: "Third" },
    ]);
    const { listCodexSessions } = await load();
    const r = listCodexSessions();
    expect(r.available).toBe(true);
    expect(r.sessions.map((s) => s.id)).toEqual(["s2", "s1", "s3"]); // updated_at desc
    expect(r.providers).toEqual(["mimo", "openai"]);
  });

  it("migrates a session's provider in both the db and the rollout file", async () => {
    const rollout = seedRollout("rollout-x.jsonl", "openai");
    seedStateDb(5, [
      { id: "s1", rollout_path: rollout, created_at: 1, updated_at: 30, model_provider: "openai", cwd: "D:/a", title: "First" },
    ]);
    const { migrateSessionProvider, listCodexSessions } = await load();
    const res = migrateSessionProvider("s1", "mimo");
    expect(res.fromProvider).toBe("openai");
    expect(res.toProvider).toBe("mimo");
    expect(existsSync(res.backupDir)).toBe(true);

    // DB updated.
    expect(listCodexSessions().sessions[0].provider).toBe("mimo");
    // Rollout session_meta updated.
    const firstLine = readFileSync(rollout, "utf-8").split("\n")[0];
    expect(JSON.parse(firstLine).payload.model_provider).toBe("mimo");
    // Second line preserved.
    expect(readFileSync(rollout, "utf-8").split("\n")[1]).toContain('"type":"event"');
  });

  it("rejects an invalid target provider and a missing session", async () => {
    seedStateDb(5, [
      { id: "s1", rollout_path: "r", created_at: 1, updated_at: 1, model_provider: "openai", cwd: "D:/a", title: "x" },
    ]);
    const { migrateSessionProvider } = await load();
    expect(() => migrateSessionProvider("s1", "bad provider!")).toThrow(/invalid target/);
    expect(() => migrateSessionProvider("nope", "mimo")).toThrow(/not found/);
  });
});
