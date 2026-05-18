# Wiring up SenseNova (商汤日日新)

> 中文：[sensenova.zh.md](./sensenova.zh.md)

[SenseNova](https://platform.sensenova.cn/docs) (baseUrl `https://token.sensenova.cn/v1`) speaks the OpenAI Chat Completions wire format, but the 6.7 Flash-Lite gateway is stricter than OpenAI's own: **any field not listed in the official request-params table is rejected**, and validation errors are frequently replaced by the un-informative `Errors in message queue response`. This doc walks through the v0.2.9+ sensenova preset that handles it in one click.

## Symptom (before)

Wiring SenseNova up as a plain generic provider, the first Claude Code / Codex request 400s with:

```
upstream returned 400: {"error":{"message":"Errors in message queue response",
                                  "type":"invalid_request_error","code":"3"}}
```

The message doesn't say **which field** is at fault.

## Root cause

SenseNova 6.7 Flash-Lite's [official request-params table](https://platform.sensenova.cn/docs) only lists:

`model / messages / stream / stream_options / temperature / top_p / max_tokens / n / stop / frequency_penalty / presence_penalty / reasoning_effort / tools / tool_choice / parallel_tool_calls / seed`

**Not listed** (and therefore rejected):

| Field | OpenAI / DeepSeek | SenseNova 6.7 Flash-Lite |
|---|---|---|
| `response_format` | accepted | **rejected** (not listed) |
| `thinking` / `enable_thinking` | / | **rejected** (the same platform's DeepSeek V4 Flash lists it; 6.7 doesn't) |
| `tools[*].function.strict: true` | accepted | **not in schema** (defensive strip) |
| `assistant.content: null` (paired with tool_calls) | accepted | **unspecified** |
| Multiple `role: "system"` messages | accepted | **unspecified** |

Plus boundary constraints:

- `temperature ∈ [0, 2]`
- `max_tokens ∈ [1, 65536]`
- 256K context (input ≤ 252K, output ≤ 64K)

Error code `"code": "3"` is the umbrella `invalid_request_error` code — the real reason should be in `message` (the [docs example](https://platform.sensenova.cn/docs) shows `"invalid temperature, should in [0,2]."`). But the gateway sometimes replaces it with `Errors in message queue response`, making field-level diagnosis painful.

## Recommended setup — admin UI one-click

Open the mimo2codex admin UI → Providers → **+ Add Provider** → fill in:

- baseUrl: `https://token.sensenova.cn/v1`

The UI will auto-detect "SenseNova" and apply these features (click "Clear and customize" on the Alert if you want to override manually):

- `dropNullStrict`: strip `tools[*].function.strict === null`
- `dropNullContent`: strip assistant `content === null`
- `dropToolChoiceAuto`: strip `tool_choice === "auto"` (auto is the default)
- `mergeSystemMessages`: merge multiple system messages into one leading entry
- `dropResponseFormat`: strip `response_format` (SenseNova doesn't accept it)
- `enhanceErrorPreset: "sensenova"`: translate `Errors in message queue response` into a readable diagnostic hint

Fill in the rest (id, envKey, defaultModel), save, and restart mimo2codex for the runtime registry to pick it up.

## Recommended setup — providers.json

```json
{
  "providers": [
    {
      "id": "sensenova",
      "displayName": "SenseNova",
      "baseUrl": "https://token.sensenova.cn/v1",
      "envKey": "SENSENOVA_API_KEY",
      "defaultModel": "sensenova-6.7-flash-lite",
      "models": [
        { "id": "sensenova-6.7-flash-lite", "contextWindow": 262144, "maxOutputTokens": 65536, "supportsImages": true },
        { "id": "deepseek-v4-flash",       "contextWindow": 262144, "maxOutputTokens": 65536, "supportsReasoning": true }
      ],
      "features": {
        "dropNullStrict": true,
        "dropNullContent": true,
        "dropToolChoiceAuto": true,
        "mergeSystemMessages": true,
        "dropResponseFormat": true,
        "enhanceErrorPreset": "sensenova"
      },
      "docsUrl": "https://platform.sensenova.cn/docs"
    }
  ]
}
```

Set the env var and start:

```bash
export SENSENOVA_API_KEY=sk-xxxxx   # get one at https://platform.sensenova.cn/console/keys
mimo2codex
```

## Available models

Source: [https://platform.sensenova.cn/docs](https://platform.sensenova.cn/docs) ("Model overview" section)

| Model ID | Description | Quota | Multimodal | Reasoning | Notes |
|---|---|---|---|---|---|
| `sensenova-6.7-flash-lite` | Lightweight multimodal agent | 1500 / 5h | text + image | reasoning_effort | Default recommended |
| `deepseek-v4-flash` | DeepSeek high-perf chat | 150 / 5h | text | thinking mode | `thinking` must NOT be sent through SenseNova's gateway (generic provider strips it) |
| `sensenova-u1-fast` | Infographic generation | 1500 / 5h | / | / | **Image generation only**, uses `/v1/images/generations`, incompatible with chat completions — not supported by mimo2codex yet |

## Troubleshooting 400s

If you've applied the features above and still get 400, work through:

1. **Enable mimo2codex debug logs to see the actual request body**:
   ```bash
   export LOG_LEVEL=debug
   ```
   The log will contain `incoming POST /v1/chat/completions raw body { ... }` for failing requests — copy that.
2. **Reproduce against SenseNova directly**: use the same body + `Authorization: Bearer $SENSENOVA_API_KEY` and curl `https://token.sensenova.cn/v1/chat/completions`. If it reproduces, the issue is in the body, not mimo2codex.
3. **Bisect**: delete fields from the body one by one. Try removing `tools` first (test plain text), then suspicious fields.
4. **Check boundaries**: `max_tokens ≤ 65536`; `temperature ∈ [0, 2]` (closed interval).
5. **If you find a field with no existing sanitizer switch**: open an issue on the mimo2codex repo with the field name and a minimal repro.

## Upgrade notes

This integration ships as a generic provider — it **does not reserve a builtin id**. If you previously configured `id="sensenova"` as a generic provider:

- It keeps working unchanged.
- Recommended: open the admin UI edit dialog → type the baseUrl in to trigger the smart default. It will auto-apply the recommended features (only if your features were all empty).
- If you had manually toggled any feature, the "already customized → don't overwrite" guard kicks in; you can either manually add the new `dropResponseFormat` / `enhanceErrorPreset` switches, or hit "Clear and customize" on the Alert to start fresh.
