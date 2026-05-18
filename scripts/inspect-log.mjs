// One-off: read a log row's request/response body from the admin sqlite.
// Usage: node scripts/inspect-log.mjs <log_id>
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";

const id = Number(process.argv[2] ?? 0);
if (!id) {
  // 无 id → 列出最近 20 条概览
  const dbPath2 = join(homedir(), ".mimo2codex", "data.db");
  const db2 = new Database(dbPath2, { readonly: true });
  const rows = db2
    .prepare(
      "SELECT id, ts, provider_id, client_model, upstream_model, status_code, duration_ms, completion_tokens, tool_call_count FROM chat_logs ORDER BY id DESC LIMIT 30",
    )
    .all();
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(4)} ${new Date(r.ts).toISOString().slice(11, 19)} prov=${r.provider_id.padEnd(8)} client=${(r.client_model ?? "").padEnd(30)} upstream=${(r.upstream_model ?? "").padEnd(30)} status=${r.status_code} ${r.duration_ms}ms out=${r.completion_tokens ?? "?"} tools=${r.tool_call_count ?? "?"}`,
    );
  }
  process.exit(0);
}

const dbPath = join(homedir(), ".mimo2codex", "data.db");
const db = new Database(dbPath, { readonly: true });
const row = db
  .prepare(
    "SELECT id, ts, provider_id, client_model, upstream_model, endpoint, stream, status_code, duration_ms, prompt_tokens, completion_tokens, request_body, response_body, tool_call_count FROM chat_logs WHERE id = ?",
  )
  .get(id);
if (!row) {
  console.error("no log with id", id);
  process.exit(1);
}

console.log("=== meta ===");
console.log({
  id: row.id,
  ts: new Date(row.ts).toISOString(),
  provider_id: row.provider_id,
  client_model: row.client_model,
  upstream_model: row.upstream_model,
  endpoint: row.endpoint,
  stream: !!row.stream,
  status_code: row.status_code,
  duration_ms: row.duration_ms,
  prompt_tokens: row.prompt_tokens,
  completion_tokens: row.completion_tokens,
  tool_call_count: row.tool_call_count,
});

if (row.request_body) {
  try {
    const req = JSON.parse(row.request_body);
    console.log("\n=== request: reasoning field ===");
    console.log(JSON.stringify(req.reasoning ?? null, null, 2));
    console.log("\n=== request: top-level keys ===");
    console.log(Object.keys(req));
    console.log("\n=== request: include field ===");
    console.log(JSON.stringify(req.include ?? null, null, 2));
    console.log("\n=== request: model ===");
    console.log(req.model);
    console.log("\n=== request: input items count ===");
    console.log(Array.isArray(req.input) ? req.input.length : typeof req.input);
  } catch (e) {
    console.error("request_body parse err:", e.message);
  }
}

if (row.response_body) {
  // 流式 → 拼接的 SSE 文本；非流式 → JSON。截首尾各看一段
  console.log("\n=== response_body length:", row.response_body.length, "===");
  const head = row.response_body.slice(0, 600);
  const tail = row.response_body.slice(-1500);
  console.log("\n--- head 600 ---");
  console.log(head);
  console.log("\n--- tail 1500 ---");
  console.log(tail);
  // 搜 reasoning_summary_text.delta 出现次数
  const reasoningEvents = (row.response_body.match(/reasoning_summary_text\.delta/g) || []).length;
  const reasoningDoneEvents = (row.response_body.match(/reasoning_summary_text\.done/g) || []).length;
  const outputItemReasoning = (row.response_body.match(/"type":"reasoning"/g) || []).length;
  const reasoningTokensMatch = row.response_body.match(/"reasoning_tokens":\s*(\d+)/);
  console.log("\n=== reasoning event counts in response stream ===");
  console.log({
    "reasoning_summary_text.delta events": reasoningEvents,
    "reasoning_summary_text.done events": reasoningDoneEvents,
    "type:reasoning items": outputItemReasoning,
    reasoning_tokens: reasoningTokensMatch ? reasoningTokensMatch[1] : "(not found)",
  });
}
