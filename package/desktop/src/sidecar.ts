import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { SidecarStatus } from "../shared/types.js";

export interface SidecarOptions {
  /** Path to the bundled mimo2codex CLI binary (or node runtime wrapper). */
  binPath: string;
  /** Extra args before --data-dir / --port */
  extraArgs?: string[];
  dataDir: string;
  port: number;
  /** Max automatic restarts on crash. Defaults to 1. */
  maxRestarts?: number;
  /** Time to wait between SIGTERM and SIGKILL during shutdown. Defaults to 2000ms. */
  killGraceMs?: number;
  /** Extra env vars merged into process.env when spawning (e.g. ELECTRON_RUN_AS_NODE). */
  extraEnv?: Record<string, string>;
}

export class SidecarManager extends EventEmitter {
  private readonly opts: Required<SidecarOptions>;
  private child: ChildProcess | null = null;
  private restartsRemaining: number;
  private currentStatus: SidecarStatus = { kind: "starting" };
  private intentionalStop = false;

  constructor(opts: SidecarOptions) {
    super();
    this.opts = {
      extraArgs: [],
      maxRestarts: 1,
      killGraceMs: 2000,
      extraEnv: {},
      ...opts,
    };
    this.restartsRemaining = this.opts.maxRestarts;
  }

  status(): SidecarStatus {
    return this.currentStatus;
  }

  /** Update the port used on the NEXT start. Caller is responsible for stopping first. */
  setPort(port: number): void {
    this.opts.port = port;
  }

  /** Update the --data-dir passed on the NEXT start. Caller stops first. */
  setDataDir(dir: string): void {
    this.opts.dataDir = dir;
  }

  async start(): Promise<void> {
    // Reset the intentional-stop flag so a stop()→start() cycle treats the
    // upcoming exit as unexpected (so auto-restart works again later).
    this.intentionalStop = false;
    // Also restore restart budget so a long-lived app doesn't exhaust it
    // across many user-driven restarts.
    this.restartsRemaining = this.opts.maxRestarts;
    this.spawnOnce();
  }

  private spawnOnce(): void {
    this.currentStatus = { kind: "starting" };
    this.emit("status", this.currentStatus);
    const args = [
      ...this.opts.extraArgs,
      "--data-dir", this.opts.dataDir,
      "--port", String(this.opts.port),
    ];
    const child = spawn(this.opts.binPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...this.opts.extraEnv },
    });
    this.child = child;
    child.stdout?.on("data", (b: Buffer) => this.emit("stdout", b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => this.emit("stderr", b.toString("utf8")));
    child.on("exit", (code, signal) => this.onExit(code, signal));
    // Mark running as soon as spawn returns; the CLI prints its own banner
    // and we don't try to wait for "listening" — simpler.
    this.currentStatus = { kind: "running", port: this.opts.port, pid: child.pid ?? -1 };
    this.emit("status", this.currentStatus);
  }

  private onExit(code: number | null, _signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.intentionalStop) return;
    if (this.restartsRemaining > 0) {
      this.restartsRemaining--;
      this.spawnOnce();
      return;
    }
    this.currentStatus = { kind: "crashed", exitCode: code, lastLog: "" };
    this.emit("status", this.currentStatus);
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.intentionalStop = true;
    const child = this.child;
    const exitP = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const grace = new Promise<void>((resolve) => setTimeout(resolve, this.opts.killGraceMs));
    await Promise.race([exitP, grace]);
    if (this.child) {
      this.child.kill("SIGKILL");
      await exitP;
    }
  }
}
