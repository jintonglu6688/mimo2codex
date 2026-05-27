import { spawn } from "node:child_process";
import { detectUpdateMethod, type UpdateMethodInfo, type UpdateMethod } from "./updateMethod.js";

export interface RunUpdateOptions {
  // Called once per output line (stdout + stderr merged). The CLI surface
  // writes these to the terminal; the webui SSE handler forwards them to the
  // browser. The callback receives a raw line, no trailing newline.
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  // Inject for testing — production code uses detectUpdateMethod() directly.
  methodOverride?: UpdateMethodInfo;
}

export interface RunUpdateResult {
  method: UpdateMethod;
  command: string;
  exitCode: number;
  // The first failing step short-circuits the chain; later steps are skipped.
  // `stepsRun` records what actually ran for diagnostics.
  stepsRun: number;
  // True iff we never spawned anything because the method was "unknown" —
  // caller should print the manual instructions instead.
  skipped: boolean;
}

// Stream lines from a chunked Buffer source. Holds onto a trailing partial
// line until the next chunk; flush() emits any remainder when the stream
// ends. Mirrors the well-known readline-over-stdout pattern.
function lineSplitter(emit: (line: string) => void): {
  push(buf: Buffer): void;
  flush(): void;
} {
  let carry = "";
  return {
    push(buf) {
      carry += buf.toString("utf8");
      const parts = carry.split(/\r?\n/);
      carry = parts.pop() ?? "";
      for (const p of parts) emit(p);
    },
    flush() {
      if (carry.length > 0) {
        emit(carry);
        carry = "";
      }
    },
  };
}

function spawnStep(
  argv: string[],
  cwd: string | undefined,
  onLine: (line: string, stream: "stdout" | "stderr") => void
): Promise<number> {
  return new Promise((resolveExit) => {
    // npm + git are cmd shims on Windows — invoking them without shell:true
    // produces ENOENT. shell:true is also safe for Unix since our argv has
    // no untrusted user input (it's hard-coded in updateMethod.ts).
    const useShell = process.platform === "win32";
    const [cmd, ...rest] = argv;
    onLine(`$ ${argv.join(" ")}${cwd ? `   (cwd: ${cwd})` : ""}`, "stdout");
    const child = spawn(cmd, rest, {
      cwd,
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const outSplit = lineSplitter((l) => onLine(l, "stdout"));
    const errSplit = lineSplitter((l) => onLine(l, "stderr"));
    child.stdout?.on("data", (b: Buffer) => outSplit.push(b));
    child.stderr?.on("data", (b: Buffer) => errSplit.push(b));
    child.on("error", (err) => {
      onLine(`error spawning ${cmd}: ${err.message}`, "stderr");
      outSplit.flush();
      errSplit.flush();
      resolveExit(127);
    });
    child.on("close", (code) => {
      outSplit.flush();
      errSplit.flush();
      resolveExit(code ?? 0);
    });
  });
}

export async function runUpdate(opts: RunUpdateOptions = {}): Promise<RunUpdateResult> {
  const info = opts.methodOverride ?? detectUpdateMethod();
  const onLine = opts.onLine ?? (() => {});

  if (info.method === "unknown") {
    onLine(
      `Cannot auto-detect install method for ${info.rootDir}. Recommended command:`,
      "stderr"
    );
    onLine(`  ${info.command}`, "stderr");
    return {
      method: info.method,
      command: info.command,
      exitCode: 0,
      stepsRun: 0,
      skipped: true,
    };
  }

  if (info.method === "desktop") {
    // Running under the Electron desktop shell — auto-update is intentionally
    // disabled. Tell the user to grab a new installer from the download page;
    // the admin UI surfaces a "Open download page" link in place of "Update now".
    onLine(info.command, "stdout");
    return {
      method: info.method,
      command: info.command,
      exitCode: 0,
      stepsRun: 0,
      skipped: true,
    };
  }

  onLine(`Updating mimo2codex via ${info.method}…`, "stdout");
  let stepsRun = 0;
  for (const step of info.steps) {
    stepsRun += 1;
    const exitCode = await spawnStep(step.argv, step.cwd, onLine);
    if (exitCode !== 0) {
      onLine(`step ${stepsRun} failed with exit code ${exitCode}; aborting.`, "stderr");
      return {
        method: info.method,
        command: info.command,
        exitCode,
        stepsRun,
        skipped: false,
      };
    }
  }
  onLine(`Update complete.`, "stdout");
  return {
    method: info.method,
    command: info.command,
    exitCode: 0,
    stepsRun,
    skipped: false,
  };
}
