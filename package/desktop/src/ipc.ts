// Typed IPC channel surface. Both main and renderer import this to
// stay in sync — exhaustive switch on the discriminant catches typos.

import type { LegacyEnvProbe, RuntimeConfig, SidecarStatus } from "../shared/types.js";

export type RendererToMain =
  | { type: "settings:load" }
  | { type: "settings:save"; payload: { runtime: RuntimeConfig; env: Record<string, string>; dataDir: string; showAdminUiAfterSave: boolean } }
  | { type: "settings:cancel"; payload: { isFirstRun: boolean } }
  | { type: "settings:chooseDataDir" }
  | { type: "settings:importLegacy" }
  | { type: "shell:openPath"; payload: { path: string } }
  | { type: "logs:subscribe" }
  | { type: "logs:unsubscribe" };

export type MainToRenderer =
  | { type: "settings:loaded"; payload: { runtime: RuntimeConfig; env: Record<string, string>; isFirstRun: boolean; userDataDir: string; legacyEnv: LegacyEnvProbe | null } }
  | { type: "settings:dataDirChosen"; payload: { path: string | null } }
  | { type: "settings:legacyImported"; payload: { imported: Record<string, string>; skipped: Record<string, string>; sourcePath: string } }
  | { type: "status"; payload: SidecarStatus }
  | { type: "logs:line"; payload: { line: string; channel: "stdout" | "stderr" } };

export const IPC_CHANNEL = "m2c-desktop";
