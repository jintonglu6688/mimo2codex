import { describe, expect, it } from "vitest";
import { detectContextOverflow, detectMalformedJsonField } from "../src/upstream/contextOverflow.js";

describe("detectContextOverflow", () => {
  it("matches OpenAI context_length_exceeded error code", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: `{"error":{"code":"context_length_exceeded","message":"This model's maximum context length is 8192 tokens."}}`,
    });
    expect(result).not.toBeNull();
    expect(result?.code).toBe("context_length_exceeded");
  });

  it("matches classic 'maximum context length' wording", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "This model's maximum context length is 128000 tokens, but the request exceeded that.",
    });
    expect(result).not.toBeNull();
  });

  it("matches 'prompt is too long'", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "prompt is too long: 12345 tokens > 8192 maximum",
    });
    expect(result).not.toBeNull();
  });

  it("matches DeepSeek/Anthropic 'input length and max_tokens exceed' wording", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "input length and `max_tokens` exceed context limit",
    });
    expect(result).not.toBeNull();
  });

  it("matches Chinese '上下文过长' style wording", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "请求失败：上下文长度超出模型限制",
    });
    expect(result).not.toBeNull();
  });

  it("matches '... tokens exceeds the maximum'", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "Requested 200000 tokens exceeds the maximum of 128000 supported by this model.",
    });
    expect(result).not.toBeNull();
  });

  it("does NOT match MiMo's webSearchEnabled error (left to provider hook)", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet:
        '{"error":{"code":"plugin_disabled","message":"webSearchEnabled is false, please enable Web Search Plugin"}}',
    });
    expect(result).toBeNull();
  });

  it("does NOT match generic 'model not found' 400", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "invalid request: model not found",
    });
    expect(result).toBeNull();
  });

  it("does NOT trigger on non-400 statuses even if snippet matches", () => {
    const result = detectContextOverflow({
      status: 401,
      snippet: "context length exceeded the cap",
    });
    expect(result).toBeNull();
  });

  it("does NOT trigger on 5xx", () => {
    const result = detectContextOverflow({
      status: 500,
      snippet: "context_length_exceeded",
    });
    expect(result).toBeNull();
  });

  it("returns null when snippet is empty (no body to inspect)", () => {
    const result = detectContextOverflow({ status: 400, snippet: undefined });
    expect(result).toBeNull();
  });

  it("embeds modelId and contextWindow in the message when provided", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "maximum context length exceeded",
      modelId: "mimo-v2.5-pro",
      contextWindow: 128_000,
    });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("mimo-v2.5-pro");
    expect(result!.message).toContain("128000");
    expect(result!.message).toContain("/compact");
  });

  it("omits model details when not provided but still mentions /compact", () => {
    const result = detectContextOverflow({
      status: 400,
      snippet: "prompt is too long",
    });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("/compact");
    expect(result!.message).not.toMatch(/当前模型 \S/);
  });

  it("includes the raw upstream snippet at the tail for debugging", () => {
    const raw = "prompt is too long: 99k > 32k";
    const result = detectContextOverflow({ status: 400, snippet: raw });
    expect(result?.message).toContain(raw);
  });
});

describe("detectMalformedJsonField", () => {
  // Real-world reproducer body from a user-reported long-conversation 400.
  const mimoSseError =
    'data:{"error":{"code":"400","message":"unexpected end of data: line 1 column 46 (char 45)","param":"","type":"BadRequest"}}\n\n';

  it("matches MiMo's SSE-wrapped 'unexpected end of data' error", () => {
    const result = detectMalformedJsonField({ status: 400, snippet: mimoSseError });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("malformed_request_field");
    expect(result!.message).toContain("malformed JSON field");
    expect(result!.message).toContain("畸形 JSON");
    expect(result!.message).toContain("tool_call.arguments");
  });

  it("matches a bare 'unexpected end of data: line 1 column N' string", () => {
    const result = detectMalformedJsonField({
      status: 400,
      snippet: "unexpected end of data: line 1 column 12",
    });
    expect(result).not.toBeNull();
  });

  it("preserves the raw upstream snippet at the tail for debugging", () => {
    const result = detectMalformedJsonField({ status: 400, snippet: mimoSseError });
    expect(result!.message).toContain(mimoSseError);
  });

  it("does NOT match unrelated 400s", () => {
    expect(
      detectMalformedJsonField({
        status: 400,
        snippet: '{"error":{"message":"invalid api key"}}',
      })
    ).toBeNull();
    expect(
      detectMalformedJsonField({
        status: 400,
        snippet: "context_length_exceeded",
      })
    ).toBeNull();
  });

  it("does NOT trigger on non-400 statuses", () => {
    expect(
      detectMalformedJsonField({ status: 500, snippet: "unexpected end of data: line 1 column 5" })
    ).toBeNull();
    expect(
      detectMalformedJsonField({ status: 200, snippet: "unexpected end of data: line 1 column 5" })
    ).toBeNull();
  });

  it("returns null when snippet is missing", () => {
    expect(detectMalformedJsonField({ status: 400, snippet: undefined })).toBeNull();
    expect(detectMalformedJsonField({ status: 400, snippet: "" })).toBeNull();
  });

  it("recovery hint mentions /compact alternative (new codex session)", () => {
    const result = detectMalformedJsonField({ status: 400, snippet: mimoSseError });
    expect(result!.message).toContain("new codex session");
    expect(result!.message).toContain("新建 codex 会话");
  });
});
