import { app } from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

export interface SidecarPaths {
  /** Path to bundled node runtime binary (or system node for dev fallback) */
  node: string;
  /** Path to compiled CLI entry point */
  cliEntry: string;
}

/**
 * Resolves the sidecar binary + CLI entry point.
 *
 * - **Packaged build**: always uses `resources/sidecar/` from electron-builder's
 *   extraResources output.
 * - **Dev (`npm run desktop:dev`)**: prefers the same `resources/sidecar/` if
 *   the user has run `npm run sidecar:build`, otherwise falls back to system
 *   `node` + the repo's compiled `dist/cli.js`. The fallback lets contributors
 *   iterate without re-running the heavy bundler on every change.
 */
export function sidecarPaths(): SidecarPaths {
  const nodeBin = process.platform === "win32" ? "node.exe" : "node";

  if (app.isPackaged) {
    const base = process.resourcesPath;
    return {
      node: join(base, "sidecar", "node-runtime", nodeBin),
      cliEntry: join(base, "sidecar", "dist", "cli.js"),
    };
  }

  // Dev mode
  const appPath = app.getAppPath();             // package/desktop
  const repoRoot = resolve(appPath, "..", ".."); // repo root
  const bundledSidecar = resolve(repoRoot, "package/desktop/resources/sidecar");

  if (existsSync(join(bundledSidecar, "node-runtime", nodeBin)) &&
      existsSync(join(bundledSidecar, "dist", "cli.js"))) {
    return {
      node: join(bundledSidecar, "node-runtime", nodeBin),
      cliEntry: join(bundledSidecar, "dist", "cli.js"),
    };
  }

  // Fallback: system node + repo dist
  const systemNode = resolveSystemNode();
  const repoCli = resolve(repoRoot, "dist", "cli.js");
  if (!existsSync(repoCli)) {
    throw new Error(
      `dev sidecar fallback expects ${repoCli} to exist. Run \`npm run build\` at the repo root first, or run \`npm run sidecar:build\` for a full bundle.`
    );
  }
  return { node: systemNode, cliEntry: repoCli };
}

function resolveSystemNode(): string {
  const lookup = process.platform === "win32" ? "where node" : "command -v node";
  try {
    const out = execSync(lookup, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean)[0];
    if (out && existsSync(out)) return out;
  } catch {
    // fall through
  }
  throw new Error(
    `Could not find 'node' on PATH. Install Node.js or run \`npm run sidecar:build\` to bundle a Node runtime.`
  );
}
