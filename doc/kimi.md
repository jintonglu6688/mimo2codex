# Wiring up Kimi (Moonshot)

> 中文：[kimi.zh.md](./kimi.zh.md)

[Kimi API platform](https://platform.kimi.com/docs) (Moonshot AI) speaks OpenAI Chat Completions and is fully compatible with standard fields. mimo2codex integrates via a generic provider — type `https://api.moonshot.cn/v1` as baseUrl in the admin UI and it auto-detects + applies the recommended features.

## Recommended setup — admin UI one-click

Admin UI → Providers → **+ Add Provider** → fill in:

- baseUrl: `https://api.moonshot.cn/v1` (in-China) or `https://api.moonshot.ai/v1` (international)

The UI auto-detects "Kimi (Moonshot)" and applies:

- `dropReasoningEffort: true` — Kimi doesn't recognize `reasoning_effort`; it uses `thinking: {enabled/disabled}` instead. If the admin UI "Codex 启用" page has "Force high reasoning effort" ON, this switch tells mimo2codex to strip `reasoning_effort` from outgoing Kimi requests to be safe.

Fill in id / envKey / defaultModel and save.

## Recommended setup — providers.json

```json
{
  "providers": [
    {
      "id": "kimi",
      "displayName": "Kimi (Moonshot)",
      "baseUrl": "https://api.moonshot.cn/v1",
      "envKey": "MOONSHOT_API_KEY",
      "defaultModel": "kimi-k2.6",
      "models": [
        { "id": "kimi-k2.6", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2.5", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2-thinking", "contextWindow": 262144, "maxOutputTokens": 32768, "supportsReasoning": true },
        { "id": "kimi-k2-thinking-turbo", "contextWindow": 262144, "supportsReasoning": true },
        { "id": "moonshot-v1-128k", "contextWindow": 131072 },
        { "id": "moonshot-v1-32k", "contextWindow": 32768 },
        { "id": "moonshot-v1-8k", "contextWindow": 8192 }
      ],
      "features": {
        "dropReasoningEffort": true
      },
      "docsUrl": "https://platform.kimi.com/docs"
    }
  ]
}
```

```bash
export MOONSHOT_API_KEY=sk-xxxxx   # get one at https://platform.kimi.com/console/api-keys
mimo2codex
```

## Available models

Source: [Kimi API docs](https://platform.kimi.com/docs)

| Model ID | Description | Default thinking | Notes |
|---|---|---|---|
| `kimi-k2.6` | Latest recommended, multimodal agentic | ON (can disable) | temperature fixed at 1.0; max_tokens ≥ 16K recommended |
| `kimi-k2.5` | Previous generation | ON | |
| `kimi-k2-thinking` | Dedicated thinking model | **Forced ON**, cannot disable | Reasoning traces are large, token consumption noticeable |
| `kimi-k2-thinking-turbo` | Turbo variant | Forced ON | |
| `moonshot-v1-8k/32k/128k` | Classic chat models | No active thinking | |

## Thinking mechanism comparison

Kimi uses `thinking: {type: "enabled"|"disabled"}` (same as mimo / deepseek). It **does not recognize** `reasoning_effort`:

| Field | Kimi behavior |
|---|---|
| `thinking: {type: "enabled"}` | Triggers thinking |
| `thinking: {type: "disabled"}` | Disables thinking (except kimi-k2-thinking, which is forced on) |
| `reasoning_effort: "high"` etc. | **Not recognized**, usually silently ignored; we strip it with dropReasoningEffort to be safe |

The `reasoning_content` field arrives as streaming deltas before `content` does. mimo2codex's streamToSse translates these correctly into Codex's reasoning_summary events.

## Notes

- **temperature**: Kimi-k2.6 docs say temperature is fixed at 1.0; other client values are fallback-coerced. mimo2codex passes the client value through; Kimi fixes it upstream.
- **max_tokens**: Kimi docs recommend ≥ 16K (especially for thinking models, since reasoning_content tokens count toward max_tokens). Codex defaults are usually sufficient.
- **Admin UI "Force high reasoning effort" switch**: **Has no effect on Kimi** — Kimi doesn't recognize reasoning_effort. With `dropReasoningEffort: true` set by the preset, the field is stripped anyway. Kimi thinking is controlled by the `thinking` field; kimi-k2.6 / kimi-k2-thinking are ON by default, no forcing needed.

## Upgrade notes

This integration ships as a generic provider — no builtin id is reserved. If you previously had a generic `id="kimi"`, it keeps working unchanged. Open it in the admin UI and let the moonshot baseUrl trigger the smart default to apply `dropReasoningEffort: true` (only if features were empty).
