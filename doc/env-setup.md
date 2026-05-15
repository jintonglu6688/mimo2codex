# .env + one-shot loader scripts · per-OS quick setup

> English · [中文](./env-setup.zh.md)
>
> Back to: [README English](../README.md) · [README 中文](../README.zh.md)

mimo2codex reads every provider's API key from an **environment variable** — keys never touch the repo, never sit naked in a config file. The downside: each new shell window is a fresh `export`. This repo ships `.env.example` plus a pair of loader scripts (`scripts/load-env.sh` / `scripts/load-env.ps1`) so you can **declare all keys once and inject them with a single command** per shell.

## What it solves

- You don't want to re-run `export MIMO_API_KEY=... && export DS_API_KEY=...` for every new shell
- You want MiMo / DeepSeek / Qwen / Kimi / OpenAI keys collected in one file
- You don't want keys living in `~/.zshrc` or your PowerShell `$PROFILE` (polluting every process, syncing to cloud backups)
- You don't want `git commit` to ever pick up a real key (`.env` is in `.gitignore`)

## 30-second quickstart

1. **Copy the template**: in the repo root, copy [.env.example](../.env.example) to `.env`
2. **Fill in keys**: open `.env`, uncomment the lines you use, replace `sk-xxxxx` with real keys
3. **Inject into your shell**: run the loader for your OS (below)
4. **Run it**: `mimo2codex`

```text
.env.example  ← template, tracked
.env          ← your real keys, gitignored
scripts/
  load-env.sh   ← bash / zsh / Git Bash / WSL
  load-env.ps1  ← Windows PowerShell
```

## Per-OS instructions

### macOS / Linux (bash / zsh)

```bash
cp .env.example .env
# edit .env with your favorite editor, e.g.:
#   MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx

source scripts/load-env.sh
# load-env: 1 variable(s) loaded from .env
#   - MIMO_API_KEY

echo $MIMO_API_KEY   # sanity check: should print your key
mimo2codex
```

> ⚠️ You must `source` (or use `.`) — **don't** run `bash scripts/load-env.sh` directly. Direct execution spawns a child shell, sets the vars there, and they evaporate on exit. The script detects this and errors out.

### Windows PowerShell

```powershell
Copy-Item .env.example .env
# notepad .env  # or any editor — fill in keys

. .\scripts\load-env.ps1
# load-env: 1 variable(s) loaded from .env
#   - MIMO_API_KEY

echo $env:MIMO_API_KEY    # sanity check
mimo2codex
```

> ⚠️ **Use the leading `. `** — that's PowerShell's "dot-source" syntax. This loader uses `Set-Item Env:` (which writes to process env, shared across scopes), so plain `.\scripts\load-env.ps1` happens to work too. But most PowerShell config loaders set regular `$variables` that get lost on exit — dot-sourcing is the safe habit so you don't get burned by the next script.

**If you hit "running scripts is disabled on this system"**:

```powershell
# Temporary bypass — current PowerShell window only, gone when you close it
Set-ExecutionPolicy -Scope Process Bypass
. .\scripts\load-env.ps1

# Or: unblock just this one script
Unblock-File .\scripts\load-env.ps1
. .\scripts\load-env.ps1
```

To allow scripts permanently for your user (doesn't affect the system):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Windows Git Bash / WSL / Cygwin

Same as macOS / Linux — use the `.sh` script:

```bash
cp .env.example .env
source scripts/load-env.sh
mimo2codex
```

### Windows cmd.exe (not recommended)

The loader scripts don't support cmd. Either switch to PowerShell (`Win+X` → Windows PowerShell) or `set` manually:

```cmd
set MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
mimo2codex
```

`set` is current-window only. To persist (any new process can read it) use `setx KEY VALUE` — but `setx` doesn't affect the current window, so you have to open a fresh cmd for it to take effect.

## `.env` syntax

The loaders follow the conventional dotenv rules:

| Form | Behavior |
|---|---|
| `KEY=value` | Standard assignment |
| `KEY="value"` / `KEY='value'` | Surrounding quotes stripped; content is literal (**no** `$var` expansion, **no** `\n` escapes) |
| `# comment` on its own line | Skipped |
| Blank line | Skipped |
| `export KEY=value` | Tolerated for compatibility — equivalent to `KEY=value` |
| Already-set env var with the same name | **Overwritten** (`.env` is the source of truth) |
| Windows CRLF line endings | bash loader auto-strips `\r`; PowerShell loader handles via `Get-Content` |
| Invalid key name (starts with digit, special chars) | Skipped with a warning |

For the full annotated list of usable keys see [.env.example](../.env.example), which covers:

- Built-in providers: `MIMO_API_KEY`, `DS_API_KEY` / `DEEPSEEK_API_KEY`
- Generic provider, single-instance form: `GENERIC_BASE_URL` / `GENERIC_API_KEY` / `GENERIC_DEFAULT_MODEL`
- Generic provider, multi-instance (matching the `envKey` field in your `providers.json`): `QWEN_API_KEY` / `KIMI_API_KEY` / `GLM_API_KEY` / `OPENAI_API_KEY` …
- Runtime config: `MIMO2CODEX_HOST` / `MIMO2CODEX_PORT` / `MIMO2CODEX_DATA_DIR` / `MIMO2CODEX_DEFAULT_PROVIDER` / `MIMO2CODEX_NO_REASONING` / `MIMO2CODEX_VERBOSE` / `MIMO2CODEX_NO_ADMIN` / `MIMO2CODEX_CONTEXT_OVERFLOW_MODE`

## FAQ

<details>
<summary><b>Do I really have to source it every new terminal?</b></summary>

Yes — env vars are per-shell, gone the moment the window closes. That's the design (keys don't persist system-wide). If you want them always available, pick a persistence strategy:

- **macOS / Linux**: append `source /path/to/mimo2codex/scripts/load-env.sh` to `~/.zshrc` or `~/.bashrc`
- **PowerShell**: edit `$PROFILE` (`code $PROFILE` or `notepad $PROFILE`) and add `. C:\path\to\mimo2codex\scripts\load-env.ps1`

The trade-off: **every** child process from that shell now sees your keys. A more conservative pattern is to only source inside the mimo2codex project directory when needed.
</details>

<details>
<summary><b>Codex desktop doesn't see the env vars I sourced. What gives?</b></summary>

GUI-launched desktop apps (Dock, Start menu) **don't inherit your shell environment**. mimo2codex's default `print-config` output already sidesteps this — it uses the `auth.json` flow (`requires_openai_auth = true` makes Codex read `~/.codex/auth.json`), no shell env required. See [Configure Codex](../README.md#3-configure-codex) in the main README.

If you stick with the legacy `env_key` mode, launch the desktop app from the command line (macOS: `open -a Codex`, Windows: `Start-Process codex`) so it inherits the current shell's env.
</details>

<details>
<summary><b>Can I see what got loaded without exposing the values?</b></summary>

The scripts only ever print **key names, never values**. `source scripts/load-env.sh` outputs:

```
load-env: 3 variable(s) loaded from .env
  - MIMO_API_KEY
  - DS_API_KEY
  - QWEN_API_KEY
```

If you want to inspect a value, `echo $MIMO_API_KEY` works but writes the key into shell history. A safer probe: `printenv MIMO_API_KEY | head -c 10` (first 10 characters only).
</details>

<details>
<summary><b>Load multiple .env files (dev / prod)?</b></summary>

The first arg to either script is the file path:

```bash
source scripts/load-env.sh .env.dev      # bash
. .\scripts\load-env.ps1 .\.env.prod     # PowerShell
```

Later sources **override** earlier ones for same-named keys — the same way `.env` itself overrides pre-existing env.
</details>

<details>
<summary><b>I accidentally committed .env. Help.</b></summary>

`.gitignore` catches it by default, but if you renamed it or `git add -f`-ed it in:

```bash
git rm --cached .env       # remove from index, keep the local file
git commit -m "untrack .env"
```

If you already pushed, **immediately revoke and reissue every leaked key** in each provider's console. You can purge history with `git filter-repo` / `bfg`, but anything that was once on the public remote should be considered leaked.
</details>
