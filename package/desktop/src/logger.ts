import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let logDir: string | null = null;

export function initLogger(userDataDir: string): void {
  logDir = join(userDataDir, "logs");
  mkdirSync(logDir, { recursive: true });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function write(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`;
  // Always echo to stderr for `electron .` console visibility during dev
  process.stderr.write(line);
  if (logDir) appendFileSync(join(logDir, `desktop-${today()}.log`), line, "utf8");
}

export const log = {
  info: (msg: string, extra?: unknown) => write("info", msg, extra),
  warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
  error: (msg: string, extra?: unknown) => write("error", msg, extra),
};
