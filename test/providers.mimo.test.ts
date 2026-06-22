import { describe, expect, it } from "vitest";
import { mimo } from "../src/providers/mimo.js";
import type { ChatRequest, ResponsesRequest } from "../src/translate/types.js";
import type { PreprocessCtx, ProviderRuntime } from "../src/providers/types.js";

// MiMo's Web Search Plugin is separately billed and OFF by default for BOTH
// token-plan (tp-) and pay-as-you-go (sk-) accounts. Forwarding web_search to
// an account without the plugin 400s ("webSearchEnabled is false"). So
// mimo2codex must NOT forward web_search unless the user explicitly opts in
// (PreprocessCtx.webSearchEnabled), and never for tp- accounts.

function ctx(opts: { isTokenPlan: boolean; webSearchEnabled?: boolean }): PreprocessCtx {
  const runtime: ProviderRuntime = {
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: opts.isTokenPlan ? "tp-x" : "sk-x",
    flags: { isTokenPlan: opts.isTokenPlan },
  };
  return {
    runtime,
    exposeReasoning: true,
    webSearchEnabled: opts.webSearchEnabled,
  };
}

function reqWithWebSearch(): ResponsesRequest {
  return {
    model: "mimo-v2.5-pro",
    input: "x",
    tools: [
      { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      { type: "function", name: "shell", parameters: { type: "object" } },
    ] as ResponsesRequest["tools"],
  };
}

function chatReqWithWebSearch(): ChatRequest {
  return {
    model: "mimo-v2.5-pro",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "web_search" },
      { type: "function", function: { name: "shell", parameters: { type: "object" } } },
    ],
  } as unknown as ChatRequest;
}

function toolTypes(chat: { tools?: Array<{ type: string }> }): string[] {
  return (chat.tools ?? []).map((t) => t.type);
}

describe("providers/mimo — web_search forwarding (default off, opt-in)", () => {
  it("drops web_search by default (webSearchEnabled unset) even on a pay-as-you-go (sk-) account", () => {
    const chat = mimo.preprocessResponses(reqWithWebSearch(), ctx({ isTokenPlan: false }));
    expect(toolTypes(chat)).not.toContain("web_search");
    expect(toolTypes(chat)).toContain("function");
  });

  it("forwards web_search when the toggle is ON and the account is pay-as-you-go (sk-)", () => {
    const chat = mimo.preprocessResponses(
      reqWithWebSearch(),
      ctx({ isTokenPlan: false, webSearchEnabled: true })
    );
    expect(toolTypes(chat)).toContain("web_search");
  });

  it("never forwards web_search on a token-plan (tp-) account, even with the toggle ON", () => {
    const chat = mimo.preprocessResponses(
      reqWithWebSearch(),
      ctx({ isTokenPlan: true, webSearchEnabled: true })
    );
    expect(toolTypes(chat)).not.toContain("web_search");
  });

  it("preprocessChat strips a web_search tool by default (toggle off)", () => {
    const out = mimo.preprocessChat(chatReqWithWebSearch(), ctx({ isTokenPlan: false }));
    expect(toolTypes(out)).not.toContain("web_search");
    expect(toolTypes(out)).toContain("function");
  });

  it("preprocessChat keeps web_search when the toggle is ON (non-tp)", () => {
    const out = mimo.preprocessChat(
      chatReqWithWebSearch(),
      ctx({ isTokenPlan: false, webSearchEnabled: true })
    );
    expect(toolTypes(out)).toContain("web_search");
  });
});
