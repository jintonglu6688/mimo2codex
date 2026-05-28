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

// Extended schema (v0.5.6) for the multi-provider settings UI — the original
// PROVIDER_KEYS only knew about the api key var, but the settings UI also
// reads / writes the optional base-url override (MiMo's tp subscription host,
// DeepSeek's enterprise tenant, the generic OpenAI-compatible endpoint) and
// `GENERIC_DEFAULT_MODEL` (required when running with generic as default).
// All fields use the exact env-var names mimo2codex's CLI consumes.
export interface ProviderConfigSpec {
  provider: "mimo" | "deepseek" | "generic";
  /** Display label shown in the settings UI */
  label: string;
  /** API key env var (required for the provider to be usable) */
  keyEnv: "MIMO_API_KEY" | "DEEPSEEK_API_KEY" | "GENERIC_API_KEY";
  /** Optional base URL override env var. Empty string ⇒ use the provider's built-in default. */
  baseUrlEnv: "MIMO_BASE_URL" | "DEEPSEEK_BASE_URL" | "GENERIC_BASE_URL";
  /** Default base URL hint shown as form placeholder */
  defaultBaseUrl: string;
  /** Optional default-model env var (only meaningful for generic). undefined for mimo/deepseek. */
  defaultModelEnv?: "GENERIC_DEFAULT_MODEL";
  /** Hint text under the api key field */
  keyHint: string;
  /** Optional hint under the base URL field (e.g. auto-detection rules) */
  baseUrlHint?: string;
}

export const PROVIDER_SPECS: ProviderConfigSpec[] = [
  {
    provider: "mimo",
    label: "MiMo (Xiaomi)",
    keyEnv: "MIMO_API_KEY",
    baseUrlEnv: "MIMO_BASE_URL",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    keyHint: "sk-xxxxxxxx 走 pay-as-you-go；tp-xxxxxxxx 走 token-plan 订阅。",
    // MiMo provider auto-routes by key prefix (see src/providers/mimo.ts —
    // isTokenPlanRuntime checks apiKey.startsWith("tp-")), so users almost
    // never need to fill this field. Surface that so people don't paste
    // the wrong host and 401.
    baseUrlHint:
      "通常不用填 —— 代理会按 key 前缀自动选择主机：sk-* → api.xiaomimimo.com，tp-* → token-plan-cn.xiaomimimo.com。只有走自建网关或测试镜像时才需要覆盖。",
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    keyHint: "sk-xxxxxxxx from https://platform.deepseek.com/api_keys",
  },
  {
    provider: "generic",
    label: "Generic OpenAI-compatible",
    keyEnv: "GENERIC_API_KEY",
    baseUrlEnv: "GENERIC_BASE_URL",
    defaultBaseUrl: "(your provider's /v1 endpoint, e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)",
    defaultModelEnv: "GENERIC_DEFAULT_MODEL",
    keyHint:
      "Any provider speaking OpenAI Chat-Completions (Qwen / GLM / Kimi / vLLM / Ollama / LM Studio …). Base URL and default model are both required.",
  },
];

/** Template placeholder string from .env.example */
export const KEY_PLACEHOLDER_PREFIX = "sk-xxxxxxxxxxxxxxxxxxxx";

/**
 * Legacy CLI install probe result (v0.5.6 — A3). Surfaced by `settings:loaded`
 * payload so the first-run welcome card can offer a one-click migration.
 * `null` means we didn't find a usable legacy `.env` (file missing, empty, or
 * already imported earlier).
 */
export interface LegacyEnvProbe {
  /** Absolute path to the legacy `.env` (~/.mimo2codex/.env on every OS) */
  sourcePath: string;
  /** Subset of env keys present in the legacy file that we would import. Values redacted to the last 4 chars on the renderer side; full values stay on disk until import. */
  keys: string[];
}

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
