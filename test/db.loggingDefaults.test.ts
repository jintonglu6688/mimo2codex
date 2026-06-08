import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { seedLoggingDefaults } from "../src/db/index.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
  );
  return db;
}

function get(db: Database.Database, key: string): string | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return r?.value ?? null;
}

describe("seedLoggingDefaults", () => {
  it("fresh install seeds 30-day retention + errors-only bodies", () => {
    const db = makeDb();
    seedLoggingDefaults(db, true);
    expect(get(db, "logging.retentionDays")).toBe("30");
    expect(get(db, "logging.bodyMode")).toBe("errors-only");
  });

  it("existing install locks in legacy behavior (off / full)", () => {
    const db = makeDb();
    seedLoggingDefaults(db, false);
    expect(get(db, "logging.retentionDays")).toBe("off");
    expect(get(db, "logging.bodyMode")).toBe("full");
  });

  it("runs only once — a later call never re-seeds (marker guard)", () => {
    const db = makeDb();
    seedLoggingDefaults(db, true);
    db.prepare("UPDATE settings SET value = '90' WHERE key = 'logging.retentionDays'").run();
    seedLoggingDefaults(db, true);
    expect(get(db, "logging.retentionDays")).toBe("90");
  });

  it("never overwrites a value the user already set", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('logging.bodyMode', 'off', 0)"
    ).run();
    seedLoggingDefaults(db, true);
    expect(get(db, "logging.bodyMode")).toBe("off");
    expect(get(db, "logging.retentionDays")).toBe("30");
  });
});
