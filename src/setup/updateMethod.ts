import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// PACKAGE_ROOT resolution mirrors src/setup/initEnv.ts. At runtime:
//   compiled: __filename = <pkg>/dist/setup/updateMethod.js
//   tsx dev:  __filename = <repo>/src/setup/updateMethod.ts
// Both shapes resolve up 2 to the package root.
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..", "..");

export type UpdateMethod = "npm-global" | "git" | "unknown";

export interface UpdateMethodInfo {
  method: UpdateMethod;
  // Root dir of the install. For npm-global: the package dir inside node_modules.
  // For git: the cloned repo root. For unknown: still PACKAGE_ROOT for context.
  rootDir: string;
  // Human-readable command the user can run to update. Always non-empty,
  // even for "unknown" — we fall back to `npm i -g mimo2codex@latest` as the
  // recommended default since it's the most common install path.
  command: string;
  // For `git` method, the chained commands we'd run as separate spawns.
  // npm-global runs a single spawn — these are descriptive only.
  steps: { argv: string[]; cwd?: string }[];
}

// Detect how this mimo2codex was installed by inspecting the package root.
// - .git/ inside the root → git clone (curl one-liner or manual clone)
// - root path under <npm prefix>/lib/node_modules/mimo2codex → npm global install
// - anything else → unknown (still suggest npm install)
export function detectUpdateMethod(): UpdateMethodInfo {
  const rootDir = PACKAGE_ROOT;

  // Heuristic 1: explicit git checkout
  if (existsSync(resolve(rootDir, ".git"))) {
    return {
      method: "git",
      rootDir,
      command:
        `git -C "${rootDir}" pull --ff-only && ` +
        `npm install --prefix "${rootDir}" --no-audit --no-fund && ` +
        `npm run --prefix "${rootDir}" build:all`,
      steps: [
        { argv: ["git", "-C", rootDir, "pull", "--ff-only"] },
        { argv: ["npm", "install", "--prefix", rootDir, "--no-audit", "--no-fund"] },
        // build:all runs tsc + vite frontend; on Windows npm.cmd needs shell:true
        // when spawned without absolute path — handled in runUpdate.
        { argv: ["npm", "run", "--prefix", rootDir, "build:all"] },
      ],
    };
  }

  // Heuristic 2: npm global install — the package sits under `node_modules/`
  // somewhere inside the npm global prefix. We don't shell out to `npm prefix
  // -g` (slow, npm might not be on PATH); a simple substring check is enough
  // for the common case and harmless if wrong (the command we suggest still
  // works for any global install regardless of prefix).
  if (rootDir.includes(`${"node_modules"}`)) {
    return {
      method: "npm-global",
      rootDir,
      command: "npm install -g mimo2codex@latest",
      steps: [{ argv: ["npm", "install", "-g", "mimo2codex@latest"] }],
    };
  }

  return {
    method: "unknown",
    rootDir,
    command: "npm install -g mimo2codex@latest",
    steps: [{ argv: ["npm", "install", "-g", "mimo2codex@latest"] }],
  };
}

export function packageRoot(): string {
  return PACKAGE_ROOT;
}
