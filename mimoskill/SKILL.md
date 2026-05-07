---
name: mimoskill
description: Use Xiaomi MiMo V2.5 (the LLM behind mimo2codex) for chat, vision, web search, TTS and ASR — and route around capabilities MiMo doesn't natively support, especially image generation needed for things like Codex Pets `/hatch`. Trigger when the user mentions MiMo, calls into mimo2codex, asks to generate / hatch a Codex pet, asks for image generation while using MiMo as the chat backend, or hits a "no image generation available" / "image_gen tool unavailable" message inside Codex.
---

# mimoskill — Xiaomi MiMo V2.5 + gap fillers

This skill bundles two things:

1. **Direct MiMo V2.5 access** — recipes for hitting `https://api.xiaomimimo.com/v1` for chat, vision, web search, TTS, and ASR (works whether or not the [mimo2codex](../README.md) proxy is running).
2. **Workarounds for MiMo's gaps** — concrete scripts for the few things MiMo doesn't do, particularly **image generation** (which is what Codex's `/hatch` pet creation needs).

## When to use

Trigger this skill when:

- User asks to hit MiMo's API directly (chat / vision / web search / TTS / ASR)
- User asks "how do I generate a Codex pet" / "/hatch isn't working" / "image_gen tool not available"
- User wants image generation as part of a MiMo-backed workflow
- User pastes the Codex error: `the image generation tool (image_gen) is not available in this environment` or `the CLI fallback requires the openai Python package`
- Anything in the `mimo2codex` repo that touches a feature MiMo doesn't support

## What MiMo V2.5 does and doesn't do

Quick answer:

| Capability | MiMo native | Best model | Notes |
|---|---|---|---|
| Text chat | ✅ | `mimo-v2.5-pro` | reasoning + tools |
| 1M context | ✅ | `mimo-v2.5-pro[1m]` | append `[1m]` suffix |
| Tool / function calling | ✅ | any | parallel calls supported |
| Vision (image input) | ✅ | `mimo-v2.5` or `mimo-v2-omni` | NOT mimo-v2.5-pro |
| Web search | ✅ | any | requires Web Search Plugin activated in MiMo console |
| TTS (speech synth) | ✅ | `mimo-v2.5-tts` | separate endpoint |
| ASR (speech recog) | ✅ | `mimo-v2.5-asr` | separate endpoint |
| Audio chat | ✅ | `mimo-v2-omni` | input only |
| Video understanding | ✅ | `mimo-v2-omni` | input only |
| **Image generation** | ❌ | — | **see workaround below** |
| Code interpreter / sandbox | ❌ | — | not provided |

For the full capability matrix and examples, read [references/models.md](references/models.md).

## Decision tree: what does the user actually want?

```
Is it chat / vision / search / TTS / ASR?
├── Yes → use MiMo directly (see "Calling MiMo directly" below) or via mimo2codex if Codex is the client
└── No, they want image generation
    │
    Is it for a Codex pet (`/hatch`)?
    ├── Yes → see "Generating a Codex pet" below
    └── No → see "Image generation in general" below
```

## Calling MiMo directly

Use `scripts/mimo_chat.py` to send a single chat completion (or stream):

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
python3 mimoskill/scripts/mimo_chat.py "your prompt here"
python3 mimoskill/scripts/mimo_chat.py --model mimo-v2.5 --image https://example.com/x.png "describe this"
python3 mimoskill/scripts/mimo_chat.py --search "今天上海天气?"
python3 mimoskill/scripts/mimo_chat.py --stream "tell me a story"
```

The script handles all the MiMo-specific quirks — `max_completion_tokens` instead of `max_tokens`, the required `text` part next to `image_url`, web_search plugin invocation, `reasoning_content` round-tripping, etc.

For non-trivial integrations, [references/models.md](references/models.md) and [the official MiMo OpenAI-compat doc](https://platform.xiaomimimo.com/docs/api/chat/openai-api) are the authoritative references.

## Generating a Codex pet (the `/hatch` alternative)

**Why this needs special handling**: Codex's built-in `/hatch` pet generation requires OpenAI's image generation API (`gpt-image-1`). MiMo doesn't have an image generation endpoint, and mimo2codex can't fake one. So `/hatch` from inside Codex won't work when Codex is pointed at MiMo.

**The workaround**: generate the pet image *outside* of Codex (using a real OpenAI key, or a free alternative), then drop the result into Codex's pet directory and restart Codex.

### Quickstart

```bash
# 1. Install the openai SDK (one-time, requires network access)
python3 -m pip install --user openai pillow

# 2. Set a real OpenAI API key (NOT the placeholder mimo2codex-local).
#    This is separate from MIMO_API_KEY and only used for image gen.
export PET_OPENAI_API_KEY=sk-real-openai-key

# 3. Generate the pet
python3 mimoskill/scripts/generate_pet.py \
    --reference path/to/source-image.jpg \
    --description "a chubby cyberpunk axolotl coding hero" \
    --out ~/Downloads/my-pet.png

# 4. Install into Codex's pet folder
bash mimoskill/scripts/install_pet.sh ~/Downloads/my-pet.png "axolotl-coder"

# 5. Restart Codex completely and select the new pet from the pet menu
```

### Step-by-step walkthrough + prompt design

Read [references/pet_workflow.md](references/pet_workflow.md) for:

- The exact Codex pet folder location on macOS / Linux / Windows
- How to make a static image work (most pets are animated GIFs, but a static PNG fallback works)
- How to generate animated states (idle / working / done) — typically requires multiple gpt-image-1 calls with edit / remix prompting
- How to mix MiMo + image gen: have MiMo write the prompt, then feed that prompt to gpt-image-1

Use the proven pet prompt formula in [assets/pet_prompt_template.md](assets/pet_prompt_template.md) — it's tuned for the chibi / sticker style Codex uses.

## Image generation in general

If the user wants image generation for some other reason (not a pet), the same workaround applies: `gpt-image-1` is the highest-quality option but requires a real OpenAI key. Free alternatives:

- **Stable Diffusion** locally via [Automatic1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — heavy setup but no per-call cost
- **Together AI** / **Replicate** — pay-as-you-go for SDXL / FLUX
- **Pollinations.ai** — free, no key required, lower quality

`scripts/generate_pet.py` defaults to gpt-image-1 but accepts `--provider pollinations` for the free path (with reduced quality).

## Cost notes

- Direct MiMo: pay-as-you-go (`sk-xxx`) or token plan (`tp-xxx`). See [pricing](https://platform.xiaomimimo.com/docs/pricing).
- Web Search plugin: separately metered per keyword search. Cap with `max_keyword`.
- gpt-image-1: ~$0.04 per 1024×1024 image (low quality), up to ~$0.17 (HD). One pet usually costs <$0.50 even with retries.
- Pollinations.ai: free.

## Don't use this skill for

- Just running mimo2codex (that's an HTTP proxy; this skill is direct API + workarounds). For mimo2codex itself, see the project [README.md](../README.md) / [README.zh.md](../README.zh.md).
- Configuring Codex (use `mimo2codex print-config` or `mimo2codex print-cc-switch`).
- Anything Anthropic / Claude — this is MiMo-specific.
