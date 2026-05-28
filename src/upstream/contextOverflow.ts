import type { ProviderEnhancedError } from "../providers/types.js";

export interface ContextOverflowDetectInput {
  status: number;
  snippet?: string;
  modelId?: string;
  contextWindow?: number;
}

// Patterns that strongly indicate the upstream rejected the request because
// the prompt exceeded the model's context window. Tested case-insensitively
// against the upstream response body. Kept conservative on purpose — false
// positives would rewrite an unrelated 400 into a misleading "context too
// long" message.
const POSITIVE_PATTERNS: readonly RegExp[] = [
  // OpenAI / OpenAI-compatible standard error code.
  /context_length_exceeded/i,
  // Classic OpenAI wording: "This model's maximum context length is N tokens".
  /maximum context length/i,
  // Loose "context length ... exceed" / "context window ... exceed|too long|too large".
  /context\s+length[\s\S]{0,80}?(exceed|too\s+long|too\s+large)/i,
  /context\s+window[\s\S]{0,80}?(exceed|too\s+long|too\s+large)/i,
  // "prompt is too long" (Anthropic-flavored providers / generic gateways).
  /prompt\s+is\s+too\s+long/i,
  // DeepSeek / Anthropic style: "input length and `max_tokens` exceed".
  /input\s+length[\s\S]{0,80}?exceed/i,
  // Chinese upstreams ("上下文" + 过长/超出/太长/超过限制).
  /上下文[\s\S]{0,40}?(过长|超出|太长|超过)/,
  /输入[\s\S]{0,40}?(过长|超出|太长|超过)/,
  // "N tokens exceeds the maximum" variants.
  /tokens?\s+(exceed|超过|超出)/i,
];

export function detectContextOverflow(
  input: ContextOverflowDetectInput
): ProviderEnhancedError | null {
  if (input.status !== 400) return null;
  const snippet = input.snippet;
  if (!snippet) return null;
  if (!POSITIVE_PATTERNS.some((re) => re.test(snippet))) return null;

  return {
    code: "context_length_exceeded",
    message: buildFriendlyMessage(input),
  };
}

// Detector for the malformed-JSON-field family of upstream 400s.
//
// Symptom: a strict upstream (MiMo / DeepSeek / SenseNova / …) rejects the
// request with a JSON parser error pointing at an early character offset, e.g.
//
//   400 BadRequest: unexpected end of data: line 1 column 46 (char 45)
//
// The position is way too early to be overall payload truncation — it always
// points at a JSON-as-string field that the upstream re-parses. In mimo2codex
// the prime suspect is `tool_calls[i].function.arguments`: if a previous turn
// finished mid-stream (length limit / network / cancel / thinking-budget),
// Codex persists a truncated `arguments` string, then echoes it back on every
// future request — the session is dead until the user starts over.
//
// Newer mimo2codex sanitizes this on both the inbound (streamToSse /
// respToResponses) and outbound (reqToChat) paths. This detector surfaces a
// bilingual recovery hint for older sessions or for the rare case the upstream
// produces a different malformed field we don't yet sanitize.
const MALFORMED_JSON_FIELD_RE = /unexpected end of data:\s*line \d+ column \d+/i;

export function detectMalformedJsonField(
  input: ContextOverflowDetectInput
): ProviderEnhancedError | null {
  if (input.status !== 400) return null;
  const snippet = input.snippet;
  if (!snippet) return null;
  if (!MALFORMED_JSON_FIELD_RE.test(snippet)) return null;

  const lines: string[] = [];
  lines.push(
    "Upstream rejected a malformed JSON field in the request (most likely a truncated tool_call.arguments)."
  );
  lines.push(
    "上游拒绝了请求里的一个畸形 JSON 字段（最大概率是被截断的 tool_call.arguments）。"
  );
  lines.push("");
  lines.push("Why this can happen / 为什么会出现：");
  lines.push(
    "  • The upstream cut a previous tool call mid-stream (length limit / network / cancel), "
  );
  lines.push("    leaving incomplete JSON in this session's history.");
  lines.push("    之前某次工具调用被中途截断（输出长度限制 / 网络 / 取消），");
  lines.push("    本会话历史里就留下了不完整的 JSON。");
  lines.push("");
  lines.push("How to recover / 如何恢复：");
  lines.push(
    "  • Upgrade to the latest mimo2codex — it sanitizes truncated tool calls automatically."
  );
  lines.push(
    "    升级到最新版 mimo2codex（新版会自动清洗截断的 tool call）。"
  );
  lines.push(
    "  • If you can't upgrade right now: start a new codex session to drop the poisoned history."
  );
  lines.push("    若暂时无法升级：新建 codex 会话以丢掉受污染的历史。");
  lines.push("");
  lines.push(`Raw upstream error: ${snippet}`);
  return {
    code: "malformed_request_field",
    message: lines.join("\n"),
  };
}

function buildFriendlyMessage(input: ContextOverflowDetectInput): string {
  const { modelId, contextWindow, snippet } = input;
  const lines: string[] = [];
  lines.push("Context length exceeded (上下文超出模型限制).");
  lines.push(
    "The conversation history sent by codex exceeds the upstream model's context window."
  );
  if (modelId || contextWindow) {
    const parts: string[] = [];
    if (modelId) parts.push(`当前模型 ${modelId}`);
    if (contextWindow) parts.push(`上下文上限 ${contextWindow} tokens`);
    lines.push(`（${parts.join("，")}）`);
  }
  lines.push("");
  lines.push("How to recover / 如何恢复：");
  lines.push(
    "  • In codex, run /compact to summarize and shrink the history, then retry."
  );
  lines.push("    在 codex 中执行 /compact 压缩历史后重试。");
  lines.push("  • Or start a new session if the task can be split.");
  lines.push("    或开启新会话拆分任务。");
  if (snippet) {
    lines.push("");
    lines.push(`Raw upstream error: ${snippet}`);
  }
  return lines.join("\n");
}
