import type { ChatRequest, ResponsesRequest } from "../translate/types.js";
import { reqToChat } from "../translate/reqToChat.js";
import type {
  PreprocessCtx,
  Provider,
  ProviderEnhancedError,
  ProviderModel,
} from "./types.js";

// Spec format for a single generic OpenAI-compatible provider. Users declare
// these in providers.json (or via GENERIC_* env vars for the single-instance
// shortcut). The factory below turns each spec into a runtime Provider that
// plugs into the existing registry / routing / preprocessing pipeline.
export interface GenericProviderSpec {
  id: string;
  shortcut?: string;
  displayName?: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  // Default "chat" — translate Responses → ChatCompletions before forwarding.
  // Set "responses" when the upstream natively speaks the Codex Responses API
  // and translation would strip fields the upstream understands.
  wireApi?: "chat" | "responses";
  // When omitted or empty, any client-supplied model id is forwarded verbatim
  // (no rewrite to defaultModel). Provide entries here only when you want
  // print-config to fill in context_window / max_output_tokens.
  models?: ProviderModel[];
  features?: { webSearch?: boolean; forceParallelToolCalls?: boolean };
  docsUrl?: string;
}

const RESERVED_IDS = new Set(["mimo", "deepseek"]);

export class GenericProviderSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenericProviderSpecError";
  }
}

export function validateSpec(spec: GenericProviderSpec): void {
  if (!spec.id || typeof spec.id !== "string") {
    throw new GenericProviderSpecError("generic provider spec missing id");
  }
  if (RESERVED_IDS.has(spec.id)) {
    throw new GenericProviderSpecError(
      `generic provider id "${spec.id}" conflicts with a built-in provider — pick a different id`
    );
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(spec.id)) {
    throw new GenericProviderSpecError(
      `generic provider id "${spec.id}" must be alphanumeric + dash/underscore (no spaces, no slashes)`
    );
  }
  if (!spec.baseUrl) {
    throw new GenericProviderSpecError(`generic provider "${spec.id}" missing baseUrl`);
  }
  if (!spec.envKey) {
    throw new GenericProviderSpecError(`generic provider "${spec.id}" missing envKey`);
  }
  if (!spec.defaultModel) {
    throw new GenericProviderSpecError(`generic provider "${spec.id}" missing defaultModel`);
  }
  if (spec.wireApi && spec.wireApi !== "chat" && spec.wireApi !== "responses") {
    throw new GenericProviderSpecError(
      `generic provider "${spec.id}" has invalid wireApi "${spec.wireApi}" — must be "chat" or "responses"`
    );
  }
}

export function createGenericProvider(spec: GenericProviderSpec): Provider {
  validateSpec(spec);

  const declaredModels: readonly ProviderModel[] = spec.models ?? [];
  const hasDeclaredModels = declaredModels.length > 0;
  const wireApi = spec.wireApi ?? "chat";
  const features = spec.features ?? {};

  return {
    id: spec.id,
    shortcut: spec.shortcut ?? spec.id,
    displayName: spec.displayName ?? spec.id,
    defaultBaseUrl: spec.baseUrl,
    baseUrlEnv: `${spec.envKey.replace(/_API_KEY$/i, "")}_BASE_URL`,
    envKeys: [spec.envKey] as const,
    defaultModel: spec.defaultModel,
    builtinModels: declaredModels,
    wireApi,
    docsUrl: spec.docsUrl,

    detectFlags(_apiKey, _baseUrl) {
      return {};
    },

    resolveModel(clientModel) {
      if (!hasDeclaredModels) {
        // Untyped passthrough — accept any model id and let the upstream
        // validate. This is the design choice that matches Codex's habit of
        // "whatever model = "..." is in config.toml gets sent verbatim".
        return { id: clientModel };
      }
      for (const m of declaredModels) {
        if (m.id === clientModel) return m;
        if (m.aliases?.includes(clientModel)) return m;
      }
      return null;
    },

    preprocessResponses(req: ResponsesRequest, ctx: PreprocessCtx): ChatRequest {
      const chat = reqToChat(req, {
        forceParallelToolCalls: !!features.forceParallelToolCalls,
        enableWebSearch: !!features.webSearch,
        imageDropDir: ctx.dataDir,
      });
      // Generic OpenAI-compat upstreams don't understand MiMo's `thinking`
      // family. Strip pre-emptively (reqToChat doesn't emit them, but a
      // future caller might).
      delete chat.thinking;
      delete chat.enable_thinking;
      return chat;
    },

    preprocessChat(req: ChatRequest, _ctx: PreprocessCtx): ChatRequest {
      const out = { ...req };
      delete out.thinking;
      delete out.enable_thinking;
      return out;
    },

    preprocessResponsesPassthrough(req: ResponsesRequest, _ctx: PreprocessCtx): ResponsesRequest {
      // Identity passthrough — the routing layer will substitute `model`
      // separately. Hook exists so users can later override for upstream
      // quirks without changing the server's branching logic.
      return req;
    },

    enhanceError(_ctx): ProviderEnhancedError | null {
      return null;
    },
  };
}
