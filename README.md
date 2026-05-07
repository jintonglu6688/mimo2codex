# mimo2codex

> English · [中文文档](./README.zh.md)

Local proxy that lets the **latest OpenAI Codex CLI** and **Codex desktop app** talk to **Xiaomi MiMo V2.5 Pro** by translating Codex's Responses API ↔ MiMo's Chat Completions API on the fly. Works standalone, or as a custom Codex provider in [cc-switch](https://github.com/farion1231/cc-switch) — switch between OpenAI / MiMo / Azure / OpenRouter etc. with one click.

> Why? MiMo's official [Codex integration doc](https://platform.xiaomimimo.com/docs/zh-CN/integration/codex) tells you the only supported wire is `wire_api = "chat"`, but newer Codex versions hard-error with `wire_api = chat is no longer supported`. The official workaround is to downgrade Codex (losing the new pet, tool, and desktop features). This proxy is a better workaround: leave Codex on the latest version, run mimo2codex locally, and Codex will think it's talking to a native Responses-API backend.
>
> Conceptually similar to [openrouter](https://openrouter.ai), [claude-code-router](https://github.com/musistudio/claude-code-router) and [y-router](https://github.com/luohy15/y-router) — pure stateless protocol translation, no scheduling, no storage.

## What works

- ✅ Codex CLI 0.x with `wire_api = "responses"`
- ✅ Codex desktop app (macOS / Windows) — same `~/.codex/config.toml`
- ✅ Pet companion (status driven by SSE event lifecycle, no special handling needed)
- ✅ Tool calling — function tools, including parallel calls
- ✅ Multi-turn conversations with mixed tool calls + reasoning
- ✅ Streaming SSE with full Responses event schema (`response.created`, `output_item.added`, `output_text.delta`, `function_call_arguments.delta`, `reasoning_summary_text.delta`, `completed`, …)
- ✅ Thinking mode passthrough — MiMo's `reasoning_content` is shown in Codex's reasoning panel and re-injected on follow-up turns to keep multi-turn tool quality high (per MiMo's docs)
- ✅ 1M context — pass `mimo-v2.5-pro[1m]` as the model
- ✅ **cc-switch integration** — `mimo2codex print-cc-switch` outputs the auth.json + config.toml snippets you paste into cc-switch's "Add Provider → Codex → Custom" dialog

## Run from source (recommended)

> The npm package isn't published yet — clone the repo and run locally.

### 0. Prerequisites

| Tool | Required | Check |
|---|---|---|
| Node.js | **≥ 18** | `node -v` |
| npm | bundled with Node | `npm -v` |
| git | any | `git --version` |

If `node -v` is missing or below 18, grab an LTS from [nodejs.org](https://nodejs.org). Windows users can also use [nvs](https://github.com/jasongin/nvs) or [nvm-windows](https://github.com/coreybutler/nvm-windows).

### 1. Clone & install dependencies

```bash
git clone https://github.com/your-org/mimo2codex.git
cd mimo2codex
npm install
```

Installs ~87 packages (typescript, vitest, tsx, nanoid, eventsource-parser); takes 30–60s.

### 2. Pick a run mode

#### Mode A — dev mode (no build, fastest to try)

Runs the TypeScript directly via `tsx`:

```bash
# Linux / macOS / Git Bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
npm run dev

# Windows PowerShell
$env:MIMO_API_KEY="sk-xxxxxxxxxxxxxxxx"
npm run dev

# Windows CMD
set MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
npm run dev
```

Pass extra flags after `--`:

```bash
npm run dev -- --port 9000
npm run dev -- --base-url https://token-plan-cn.xiaomimimo.com/v1
npm run dev -- print-cc-switch
```

#### Mode B — build then run (lowest runtime overhead)

Compiles to plain JS, runs with vanilla Node — startup < 100ms, no tsx in process:

```bash
npm run build           # one-time
npm start               # or: node dist/cli.js
npm start -- --port 9000
node dist/cli.js print-cc-switch
```

`dist/` is git-ignored. Re-run `npm run build` after editing source.

#### Mode C — register `mimo2codex` as a global command (no publish needed)

```bash
npm run build
npm link
```

Then from any directory:

```bash
mimo2codex --version
mimo2codex print-cc-switch
MIMO_API_KEY=sk-xxx mimo2codex
```

To undo: `npm unlink` in the repo, or `npm rm -g mimo2codex` globally.

> Throughout the rest of this README, `mimo2codex …` means whichever invocation matches your mode: `npm run dev -- …` (A), `node dist/cli.js …` (B), or `mimo2codex …` (C).

### 3. Run the tests (optional)

```bash
npm test
```

Expect 25 passing across 3 files.

### 4. Keep the proxy running in the background

#### macOS / Linux — systemd user unit

Create `~/.config/systemd/user/mimo2codex.service`:

```ini
[Unit]
Description=mimo2codex — Codex Responses → Xiaomi MiMo proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/mimo2codex
Environment="MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx"
ExecStart=/usr/bin/node dist/cli.js
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now mimo2codex
journalctl --user -u mimo2codex -f
```

#### Cross-platform — pm2

```bash
npm install -g pm2
cd mimo2codex && npm run build
MIMO_API_KEY=sk-xxx pm2 start dist/cli.js --name mimo2codex
pm2 save && pm2 startup
```

#### Windows — Task Scheduler

1. Task Scheduler → Create Basic Task
2. Trigger: At log on
3. Action: Start a program
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `D:\path\to\mimo2codex\dist\cli.js`
   - Start in: `D:\path\to\mimo2codex`
4. Set `MIMO_API_KEY` in the task's environment, or globally in System Properties → Environment Variables

### 5. Updating

```bash
cd mimo2codex
git pull
npm install        # only if dependencies changed
npm run build      # required for Mode B/C
# restart your background process
```

---

## Get a MiMo API key

Sign up at [platform.xiaomimimo.com](https://platform.xiaomimimo.com), create a key in **Console → API Keys**. Either pay-as-you-go (`sk-xxx`) or token-plan (`tp-xxx`) works.

## Use

### 1. Start the proxy

Pick whichever launch mode you set up above:

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
npm run dev          # or: node dist/cli.js / mimo2codex
```

The startup banner prints the **default snippet** (auth.json variant — works for Codex CLI **and** desktop app, no env vars needed):

```
mimo2codex v0.1.0 listening on http://127.0.0.1:8788
upstream:    https://api.xiaomimimo.com/v1

# Step 1 — write ~/.codex/auth.json
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

### 2. Write the two files

| file | macOS / Linux | Windows |
|---|---|---|
| auth.json | `~/.codex/auth.json` | `%USERPROFILE%\.codex\auth.json` |
| config.toml | `~/.codex/config.toml` | `%USERPROFILE%\.codex\config.toml` |

The `OPENAI_API_KEY` value is just a placeholder — the proxy doesn't validate inbound credentials. Your real MiMo key stays in `MIMO_API_KEY` on the machine running mimo2codex.

> ⚠️ If you also use Codex with your real OpenAI account, this overwrites your OpenAI login. Use cc-switch (next section) to manage multiple providers cleanly.

### 3. Restart Codex (desktop app: required)

If you use the **Codex desktop app**: fully quit it (system tray / menu bar → Quit, not just close the window) and relaunch — otherwise it won't pick up the new auth.json.

If you use the **Codex CLI**: just run it:

```bash
codex
> Write a Python fibonacci function and save it to fib.py
```

The pet, tool calls, reasoning summary, and multi-turn flow all work. Pass `--no-reasoning` when starting the proxy to hide reasoning from the terminal (it's still re-injected to MiMo for multi-turn quality).

> 💡 **Want the env-var variant** (preserves your OpenAI auth.json untouched)? Run `npm run dev -- print-config --env-key`. **Codex CLI only** — desktop apps launched from Finder/Start Menu don't see shell env vars.

## Use with cc-switch

[cc-switch](https://github.com/farion1231/cc-switch) is a desktop app that manages multiple Codex / Claude Code / OpenCode providers and lets you switch between them in one click. Its built-in Codex preset list does **not** include MiMo (because MiMo doesn't speak Responses API) — but you can plug mimo2codex in as a custom provider.

> ⚠️ **Two parts must run side-by-side**: the **mimo2codex proxy** (a long-running HTTP server you keep alive) and the **cc-switch GUI** (which holds your provider configs). `print-cc-switch` only prints config text to copy — it doesn't start anything.

1. **Keep mimo2codex running** in a terminal (don't close it):

   ```bash
   cd /path/to/mimo2codex
   export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
   npm run dev          # or node dist/cli.js, see "Run from source" above
   ```

   Wait for `listening on http://127.0.0.1:8788`. To run it as a background service, see [step 4 above](#4-keep-the-proxy-running-in-the-background).

2. **In a separate terminal**, print the cc-switch snippets:

   ```bash
   cd /path/to/mimo2codex
   npm run dev -- print-cc-switch     # or: node dist/cli.js print-cc-switch
   ```

   It outputs two blocks: an `auth.json` block and a `config.toml` block.

3. In cc-switch GUI: switch to the **Codex** tab → click **+** → choose **App-specific Provider** → preset = **Custom**.
4. Paste the `auth.json` block into the auth.json textarea, paste the `config.toml` block into the config.toml textarea, set the name to `MiMo (via mimo2codex)`, click **Add**.
5. Click the new entry to make it active. cc-switch writes `~/.codex/auth.json` + `~/.codex/config.toml` for you.
6. Run `codex`. Switch back to OpenAI Official / Azure / OpenRouter / etc. anytime by clicking another entry in cc-switch — mimo2codex keeps running and only sees traffic when its provider is selected.

cc-switch's "Fetch Models" button on the provider form calls `/v1/models`, which mimo2codex implements — so the model dropdown will list `mimo-v2.5-pro`, `mimo-v2.5-pro[1m]`, and `mimo-v2-flash` automatically.

## CLI flags

| Flag | Env | Default | Notes |
|---|---|---|---|
| `--port`, `-p` | `MIMO2CODEX_PORT` | `8788` | listen port |
| `--host` | `MIMO2CODEX_HOST` | `127.0.0.1` | bind host (keep on loopback) |
| `--base-url` | `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | switch to `https://token-plan-cn.xiaomimimo.com/v1` for the Token Plan |
| `--api-key` | `MIMO_API_KEY` | _required_ | upstream MiMo key |
| `--no-reasoning` | `MIMO2CODEX_NO_REASONING=1` | off | hide reasoning from Codex (still preserved between turns) |
| `--verbose`, `-v` | `MIMO2CODEX_VERBOSE=1` | off | log every translated request |

Subcommands:

```bash
mimo2codex print-config             # write the ~/.codex/config.toml snippet to stdout
mimo2codex print-cc-switch          # write the cc-switch auth.json + config.toml snippets
mimo2codex --port 9000 print-config # adjust port in the snippet
```

## How it works

```
┌─────────────┐   POST /v1/responses    ┌──────────────┐   POST /v1/chat/completions   ┌─────────────┐
│ Codex CLI / │ (wire_api="responses")  │  mimo2codex  │   (chat completions, SSE)     │ Xiaomimimo  │
│ Codex App   │ ──────────────────────► │  127.0.0.1   │ ────────────────────────────► │ MiMo V2.5   │
└─────────────┘ ◄────────────────────── │  :8788       │ ◄──────────────────────────── └─────────────┘
                  Responses SSE         └──────────────┘   Chat SSE
```

For each request:

1. Codex POSTs a Responses payload (`input` array of message/function_call/function_call_output/reasoning items).
2. mimo2codex translates `input` → Chat `messages`, folding consecutive `reasoning` + `function_call` items into a single assistant turn with `reasoning_content` + `tool_calls`.
3. mimo2codex POSTs to MiMo's `/v1/chat/completions` (Bearer auth).
4. Streams back Chat SSE chunks; the state machine in `streamToSse.ts` rewrites them as Responses SSE events.

That's it. The proxy is fully stateless — no `previous_response_id` storage, no caching, no key validation against incoming requests. Run as many instances as you want.

## Troubleshooting

**Codex shows `Missing environment variable: MIMO2CODEX_KEY` (or similar env var error)**

Your `~/.codex/config.toml` has `env_key = "MIMO2CODEX_KEY"`, which makes Codex require that env var to be set in **its own** process environment. The Codex desktop app — launched from Finder / Start Menu — does **not** inherit shell env vars set via `export` or `setx`.

**Fix (recommended — switch to auth.json, works for CLI and desktop)**:

1. In `~/.codex/config.toml`, replace:
   ```toml
   env_key = "MIMO2CODEX_KEY"
   ```
   with:
   ```toml
   requires_openai_auth = true
   ```
2. Write `~/.codex/auth.json`:
   ```json
   { "OPENAI_API_KEY": "mimo2codex-local" }
   ```
3. **Fully quit and relaunch Codex** (system tray → Quit on desktop; not just close).

Or just run `npm run dev -- print-config` to get the ready-made snippets.

**Want to keep the env-var approach (CLI only)**: ensure the env var is set in the shell that launches `codex`. On Windows use `setx MIMO2CODEX_KEY anything` and open a **new** CMD window — `setx` doesn't affect already-open shells. Desktop apps still won't see this; use the auth.json variant or cc-switch instead.

---

**mimo2codex is running but Codex hangs / 504 / connection refused**

Check:
1. The mimo2codex terminal still shows `listening on http://127.0.0.1:8788`
2. `curl http://127.0.0.1:8788/healthz` returns `{"ok":true,...}`
3. config.toml `base_url` ends with `/v1`: `http://127.0.0.1:8788/v1`
4. Port not in use? Switch with `npm run dev -- --port 9999` and update `base_url` accordingly

---

**Upstream returns 401 / `authentication_error`**

Your `MIMO_API_KEY` (the one mimo2codex uses to call MiMo) is invalid. Get a new one at the [MiMo console](https://platform.xiaomimimo.com/#/console/api-keys). `sk-xxx` keys go with `https://api.xiaomimimo.com/v1`; `tp-xxx` keys go with `https://token-plan-cn.xiaomimimo.com/v1`.

---

## FAQ

**Does this support Codex's pet feature?**
Yes — pets are a desktop UI overlay driven by Codex's internal status (working / waiting-input / done / error). That status is computed from the Responses SSE event lifecycle (`response.created`, `response.in_progress`, `response.output_item.added`, `response.completed`, `response.failed`). The proxy emits exactly those events, so pets behave normally.

**Does this support tool calling?**
Yes. Codex's local shell, file edit, web fetch, and any custom tools all flow through unchanged — the proxy translates `function_call` Responses items ↔ `tool_calls` Chat fields, including arguments-delta streaming for parallel calls.

**What about images / audio?**
The proxy passes `input_image` parts through as `image_url` parts. Note: MiMo's chat API only accepts images on the `mimo-v2-omni` model; on `mimo-v2.5-pro` they will be silently dropped by upstream. `input_file` is dropped with a warning (MiMo chat API doesn't support it).

**Token plan endpoint?**
Pass `--base-url https://token-plan-cn.xiaomimimo.com/v1` and use your `tp-xxx` key.

**Is reasoning ever lost?**
No. Even with `--no-reasoning` the proxy still receives and stores `reasoning_content` so it can re-inject it on the next turn (MiMo recommends this for multi-turn tool quality). The flag only controls whether reasoning is surfaced to the Codex terminal.

**Why not just patch Codex to accept the chat wire?**
That works for the CLI today (downgrade to 0.80.0), but you lose pets, the new desktop release, and any future improvements. A protocol shim is a smaller, longer-lived fix.

**How do I see what the proxy is doing?**
Start with `--verbose` (or `MIMO2CODEX_VERBOSE=1`). Each upstream POST is logged to stderr with model, message count, tool count, stream flag, and a redacted key. No request bodies are logged.

## Project layout

```
mimo2codex/
├── src/
│   ├── cli.ts                    # entry: argv, server boot, snippet printing
│   ├── server.ts                 # node:http server, routes /v1/responses, /v1/models, /healthz
│   ├── config.ts                 # env + flag merge
│   ├── upstream/
│   │   ├── mimoClient.ts         # fetch wrapper (retry, error normalization)
│   │   └── chatStream.ts         # upstream Chat SSE → ChatStreamChunk async iterator
│   ├── translate/
│   │   ├── types.ts              # Responses + ChatCompletions types
│   │   ├── reqToChat.ts          # request-direction translator
│   │   ├── respToResponses.ts    # non-stream response translator
│   │   └── streamToSse.ts        # streaming state machine
│   └── util/{ids,sse,log}.ts
├── test/                          # 25 vitest tests
├── dist/                          # tsc output (generated)
├── package.json / tsconfig.json / vitest.config.ts
```

## License

MIT
