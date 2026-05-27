import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "../shared/types.js";

export const DEFAULT_RUNTIME: RuntimeConfig = {
  port: 8788,
  autostart: false,
};

const FILE = "runtime.json";

export function loadRuntime(userDataDir: string): RuntimeConfig {
  const path = join(userDataDir, FILE);
  if (!existsSync(path)) return DEFAULT_RUNTIME;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeConfig>;
    return { ...DEFAULT_RUNTIME, ...parsed };
  } catch {
    return DEFAULT_RUNTIME;
  }
}

export function saveRuntime(userDataDir: string, cfg: RuntimeConfig): void {
  mkdirSync(userDataDir, { recursive: true });
  // Strip ephemeral fields (set per-launch, not persisted)
  const { launchedByAutostart: _l, showAdminUiAfterSave: _s, ...persisted } = cfg;
  void _l; void _s;
  writeFileSync(join(userDataDir, FILE), JSON.stringify(persisted, null, 2), "utf8");
}
