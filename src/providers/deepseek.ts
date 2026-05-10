import type { ChatRequest, ResponsesRequest } from "../translate/types.js";
import { reqToChat } from "../translate/reqToChat.js";
import type { PreprocessCtx, Provider, ProviderModel } from "./types.js";

// Builtin DeepSeek model catalog. Source: https://api-docs.deepseek.com/zh-cn/
// All current DeepSeek models share the same window: 1M input / 384K max output.
// `deepseek-chat` and `deepseek-reasoner` are the legacy aliases that route to
// `deepseek-v4-flash` (non-thinking / thinking respectively); they're announced
// for deprecation 2026-07-24. We keep them as aliases for backwards compat.
const DEEPSEEK_CONTEXT = 1_000_000;

const BUILTIN_MODELS: readonly ProviderModel[] = [
  {
    id: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    supportsReasoning: true,
    contextWindow: DEEPSEEK_CONTEXT,
  },
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    aliases: ["deepseek-chat", "deepseek-reasoner"],
    supportsReasoning: true,
    contextWindow: DEEPSEEK_CONTEXT,
  },
  {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat (legacy)",
    deprecatedAfter: "2026-07-24",
    contextWindow: DEEPSEEK_CONTEXT,
  },
  {
    id: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner (legacy)",
    supportsReasoning: true,
    deprecatedAfter: "2026-07-24",
    contextWindow: DEEPSEEK_CONTEXT,
  },
];

export const deepseek: Provider = {
  id: "deepseek",
  shortcut: "ds",
  displayName: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com/v1",
  baseUrlEnv: "DEEPSEEK_BASE_URL",
  envKeys: ["DS_API_KEY", "DEEPSEEK_API_KEY"] as const,
  defaultModel: "deepseek-v4-pro",
  builtinModels: BUILTIN_MODELS,

  detectFlags(_apiKey, _baseUrl) {
    return {};
  },

  resolveModel(clientModel) {
    for (const m of BUILTIN_MODELS) {
      if (m.id === clientModel) return m;
      if (m.aliases?.includes(clientModel)) return m;
    }
    return null;
  },

  preprocessResponses(req: ResponsesRequest, _ctx: PreprocessCtx): ChatRequest {
    // DeepSeek is OpenAI Chat Completions compatible. No `thinking` field, no
    // `web_search` builtin (drop those tools), no MiMo-style force-parallel
    // override (respect the client's value).
    const chat = reqToChat(req, {
      forceParallelToolCalls: false,
      enableWebSearch: false,
    });
    delete chat.thinking;
    delete chat.enable_thinking;
    // The V4 family REQUIRES `reasoning_content` to be echoed back on every
    // prior assistant message in thinking mode (400: "The reasoning_content
    // in the thinking mode must be passed back to the API"). reqToChat
    // already re-injects it from Codex's reasoning items, so we leave it
    // alone. The legacy `deepseek-reasoner` is the inverse — it 400s if
    // reasoning_content IS present in the input — so we strip there.
    if (isLegacyR1Model(chat.model)) {
      stripReasoningContent(chat);
    }
    return chat;
  },

  preprocessChat(req: ChatRequest, _ctx: PreprocessCtx): ChatRequest {
    const out = { ...req };
    delete out.thinking;
    delete out.enable_thinking;
    if (isLegacyR1Model(out.model)) {
      out.messages = out.messages.map(cloneWithoutReasoning);
    }
    return out;
  },

  enhanceError(_ctx) {
    return null;
  },
};

// Legacy DeepSeek-R1 (`deepseek-reasoner`) rejects requests whose input
// includes `reasoning_content`. The V4 family (deepseek-v4-pro, v4-flash) is
// the opposite — it REQUIRES the field on prior assistant messages whenever
// thinking mode is on. So strip only for R1.
function isLegacyR1Model(model: string): boolean {
  return model === "deepseek-reasoner";
}

function cloneWithoutReasoning(m: ChatRequest["messages"][number]): ChatRequest["messages"][number] {
  if (!("reasoning_content" in m) || m.reasoning_content == null) return m;
  const { reasoning_content: _drop, ...rest } = m;
  void _drop;
  return rest;
}

function stripReasoningContent(chat: ChatRequest): void {
  for (let i = 0; i < chat.messages.length; i++) {
    const m = chat.messages[i];
    if (m.reasoning_content !== undefined) {
      chat.messages[i] = cloneWithoutReasoning(m);
    }
  }
}
