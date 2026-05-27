// Cross main/renderer typed surface. Imported via path alias in main
// (NodeNext) and via Vite (Bundler resolution) in renderer.

export interface RuntimeConfig {
  port: number;
  autostart: boolean;
  /** Set by --autostart-launched on boot, NOT persisted */
  launchedByAutostart?: boolean;
  /** Was admin UI window opened on the most recent Save & Restart */
  showAdminUiAfterSave?: boolean;
}

export type SidecarStatus =
  | { kind: "starting" }
  | { kind: "running"; port: number; pid: number }
  | { kind: "crashed"; exitCode: number | null; lastLog: string };

export interface ProviderEnvKey {
  provider: "mimo" | "deepseek" | "generic";
  envKey: "MIMO_API_KEY" | "DEEPSEEK_API_KEY" | "GENERIC_API_KEY";
}

export const PROVIDER_KEYS: ProviderEnvKey[] = [
  { provider: "mimo", envKey: "MIMO_API_KEY" },
  { provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
  { provider: "generic", envKey: "GENERIC_API_KEY" },
];

/** Template placeholder string from .env.example */
export const KEY_PLACEHOLDER_PREFIX = "sk-xxxxxxxxxxxxxxxxxxxx";

// Renderer-side global injected by preload.cjs via contextBridge.
// Kept loose (unknown) here because the strict union types live in src/ipc.ts
// and can't be imported across the main/renderer boundary without bundling.
// Renderers call `window.m2c.send(msg)` with their typed payloads directly.
declare global {
  interface Window {
    m2c: {
      send: (msg: unknown) => void;
      on: (handler: (msg: import("../src/ipc.js").MainToRenderer) => void) => () => void;
      openPath: (p: string) => void;
      chooseDataDir: () => void;
    };
  }
}
