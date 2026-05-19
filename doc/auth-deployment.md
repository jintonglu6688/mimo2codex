# Authentication & multi-user deployment

mimo2codex started life as a "zero-auth local proxy" — single machine, Codex talks direct, no users / passwords / API keys.

From v0.2.16 onwards there's a second runtime mode: **Server mode**. Flip it on when you're putting mimo2codex behind a Docker container / an internal network / a small private circle, and you get:

- Login system (local accounts + optional Gitee / GitHub OAuth)
- Bearer-token gate on the proxy endpoints (so randos on the LAN can't burn through your upstream key)
- Per-user BYOK — each user can drop in their own upstream API key, encrypted at rest
- Codex client config history + downloadable apply bundle (a container can't write to your host's `~/.codex`, so we hand back the files + a tiny script to run locally)

> 💡 **Single-user local users see no change** — `authMode` defaults to `off`, and every existing UX is bit-for-bit the same. Nothing below matters until you flip the switch on a server-style deployment.

## Contents

- [Quick comparison](#quick-comparison)
- [Turn Server mode on](#turn-server-mode-on)
  - [Local development (dev / global npm)](#local-development-dev--global-npm)
  - [Docker deployment](#docker-deployment)
- [First start: create the initial admin](#first-start-create-the-initial-admin)
- [Logging in day-to-day](#logging-in-day-to-day)
- [Bearer tokens for the proxy (`/v1/*`)](#bearer-tokens-for-the-proxy-v1)
- [BYOK: per-user upstream keys](#byok-per-user-upstream-keys)
- [Codex config sync & history](#codex-config-sync--history)
- [OAuth: Gitee / GitHub social login](#oauth-gitee--github-social-login)
- [Master key](#master-key)
- [Ops tips](#ops-tips)
- [Troubleshooting](#troubleshooting)

## Quick comparison

| | Local mode (default `authMode=off`) | Server mode (`authMode=on`) |
|---|---|---|
| Login | not required | `/admin/login` form or OAuth |
| `/v1/*` auth | wide open | `Authorization: Bearer m2c_...` required |
| `/admin/*` auth | wide open | session cookie; unauth → login page |
| Upstream key source | env / .env | env / .env (shared) **plus** per-user BYOK (overrides) |
| Codex config writes | direct to `~/.codex/` | none; downloadable bundle + script for the user's own machine |
| Docker image default | — | **on by default** (Dockerfile sets `ENV MIMO2CODEX_AUTH=on`) |

## Turn Server mode on

**The single most important fact**: mimo2codex only auto-loads `~/.mimo2codex/.env` (a file inside the data dir). It does **not** load the `.env` at the repo root. Dropping `MIMO2CODEX_AUTH=on` into your project `.env` does nothing.

### Local development (dev / global npm)

Pick whichever is most convenient:

**1. CLI flag (most direct)**

```powershell
# Windows PowerShell
npm run dev -- --auth on

# macOS / Linux
npm run dev -- --auth on
```

npm forwards anything after `--` to the underlying `tsx src/cli.ts`, which parses `--auth on` and sets `authMode=on`.

**2. Shell environment variable**

```powershell
# PowerShell
$env:MIMO2CODEX_AUTH = "on"
npm run dev

# bash / zsh
export MIMO2CODEX_AUTH=on
npm run dev
```

Note: only effective in the current shell session.

**3. Write to `~/.mimo2codex/.env` (persistent)**

```bash
# If the file doesn't exist yet, run init once
node dist/cli.js init    # or `mimo2codex init` if you installed globally

# Edit ~/.mimo2codex/.env, add:
MIMO2CODEX_AUTH=on
```

Every future `npm run dev` / `mimo2codex` will pick this up. To disable, comment or remove the line.

> Want to confirm? Watch the startup log — server mode prints `INFO auth: on — admin login required`, plus (while the users table is empty) a **First-run admin setup needed** banner pointing at `http://<host>:<port>/admin/`. Seen it ⇒ on; not seen ⇒ `authMode=off`.

### Docker deployment

The Docker image already ships with `MIMO2CODEX_AUTH=on` baked in. Nothing extra to do:

```bash
docker compose up -d
# Just open the browser — no docker logs needed:
open http://localhost:8788          # mac / Linux
start http://localhost:8788         # Windows
```

If for whatever reason you want to disable auth inside Docker (**not recommended** — that exposes your upstream key to anyone who can reach the container port):

```yaml
# docker-compose.yml
services:
  mimo2codex:
    environment:
      - MIMO2CODEX_AUTH=off
```

## First start: create the initial admin

After starting the service, just open `http://<host>:8788/admin/` in a browser. The SPA notices the `users` table is empty and routes straight to the **First-run setup** page:

- **Admin username** — pick anything (e.g. `root` / `admin`)
- **Display name** — optional, defaults to the username
- **Password** — minimum 8 characters

Submit and the server:

1. Re-checks the `users` table is still empty (200 ⇒ you are the first admin)
2. Inserts the row with `is_admin = 1`
3. Sets a session cookie and redirects you into `/admin/`

Same first-run pattern as Jellyfin / Nextcloud / Synology — **first browser to reach the page becomes admin**. No console reading, no docker logs, no tokens to copy.

### Zero-friction Docker flow

```bash
docker compose up -d
open http://localhost:8788          # mac / Linux
start http://localhost:8788         # Windows
```

No `docker logs`, no `docker exec`, no token to copy around.

> ⚠️ **Security assumption**: this flow assumes the deployment sits behind a firewall / reverse proxy or on a private network — i.e. you reach mimo2codex before any outsider can. If you expose the port straight to the public internet, open the browser immediately after starting the service or anyone who can reach the port can become admin. For stricter zero-day protection, put an IP allowlist on your reverse proxy.

## Logging in day-to-day

After the initial admin is created, hitting `/admin/` redirects to `/admin/login`. The default session TTL is 7 days, sliding on activity.

The left sidebar (after login):

- **My account** → `/admin/account`: manage your own proxy API keys, BYOK upstream keys, and OAuth bindings. Visible to all users.
- **Users** → `/admin/users`: list every account, see usage stats, disable/enable, toggle admin role, flip open-registration. Admins only.

The top-right user menu is a shortcut that mirrors the same "Account" and "Sign out" actions.

Admins also see an **OAuth providers (admin)** card at the bottom of `/admin/account` to wire up Gitee / GitHub client IDs / secrets / callback URLs.

The open-registration toggle lives at the top of `/admin/users` (default OFF). When ON, anyone can self-register at `/admin/register`; when OFF, only admins can create accounts.

## Bearer tokens for the proxy (`/v1/*`)

In Server mode every `/v1/responses` and `/v1/chat/completions` request needs:

```
Authorization: Bearer m2c_<64 hex>
```

How to mint one:

1. Sign in → `/admin/account` → **My API keys** card
2. Give it a name (e.g. `laptop` / `codex-cli`), click **Create key** (leaving the name blank auto-generates one)
3. The plaintext is shown **exactly once** — copy it immediately
4. Put it into your Codex config in place of the placeholder

### Codex config

`~/.codex/auth.json`:

```json
{ "OPENAI_API_KEY": "m2c_<your token>" }
```

`~/.codex/config.toml`: set `base_url` to your deployment (`http://<host>:8788/v1` over LAN, or `https://your-domain/v1` over a TLS reverse proxy).

> Don't want to edit files by hand? `/admin/codex` → **Current state** card → **Export to local** button downloads a ready-to-apply bundle. See [Codex config import / export](#codex-config-import--export) below for the full flow.

## BYOK: per-user upstream keys

`/admin/account` → **My upstream keys (BYOK)**, one row per registered provider:

- Empty state shows *Using deployment-shared key* — requests use whatever the operator put into env
- Click **Set BYOK** → paste your own MiMo / DeepSeek / generic key → Save
- After saving: your requests run on your key, billing goes to your account; other users are untouched

**Encrypted storage**: BYOK values are AES-256-GCM ciphertext in SQLite. The Web UI never shows the plaintext again, so keep your original copy (you can always re-issue it on the upstream platform).

**Fallback behavior**: if the master key gets rotated and the old ciphertext no longer decrypts, BYOK silently falls back to the shared key (the request won't 500). The user re-enters their key once to fix it.

## Codex config import / export

`/admin/codex` → **Current state** card → two buttons in the top-right corner give you three flows:

### Export to local ("I configured it here, get it onto my client machine")

1. Click **Export to local** → a tutorial modal opens (no download yet)
2. Read the steps + m2c-key note; only the **Download the 4 files** button starts any transfer
3. Browser saves `auth.json`, `config.toml`, `apply-*.sh`, `apply-*.ps1` into the default download folder
4. **In server mode** the downloaded `auth.json` carries the placeholder `OPENAI_API_KEY: "mimo2codex-local"`. It is NOT a usable key. You need to:
   - Go to `/admin/account` → **My API keys**, click **Create key**
   - Copy the plaintext shown exactly once
   - Open the downloaded `auth.json` and replace `mimo2codex-local` with the m2c key
5. **In local mode** the placeholder is fine — `/v1/*` is unauthenticated, Codex can send anything
6. Put all 4 files into the same folder and run on your machine:
   - macOS / Linux: `bash apply-xxx.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File apply-xxx.ps1`
7. The script backs up your existing `~/.codex/auth.json|config.toml` as `*.bak.<ts>` and writes the new files
8. Restart Codex (close and reopen the CLI / desktop app)

### Import from local ("I switched machines / want to archive what I already have")

1. Click **Import from local** → modal opens in two phases
2. Phase 1 is the guide: where to find local files + the m2c key reminder
3. Click **Got it, start filling in** to switch to the form
4. Paste in your local `~/.codex/auth.json` and `config.toml` contents, optional provider / model / note
5. Submit:
   - **Local mode**: writes the files straight to `~/.codex/` (original files backed up as `*.bak.<ts>`)
   - **Server mode**: archive-only into `codex_config_history`, no filesystem writes
6. The imported entry shows up in the **History** tab — click **Bundle** any time to roll back to it

### History (timeline + roll back to any point)

The **History** tab at the bottom of `/admin/codex` lists the per-user config timeline:

- Each user keeps the earliest `initial` snapshot (state of `~/.codex` before mimo2codex ever applied) plus the most recent 10 apply / restore / import entries
- The `initial` row is never auto-deleted — bundle-download it to fully "uninstall" mimo2codex's effects on Codex
- Every row has a **Bundle** button. The download flow is the same as Export (including the server-mode placeholder + manual m2c key paste).

### Runtime override (switch upstream without rewriting files)

If you just want a temporary upstream/model swap without touching `~/.codex/`:

- `/admin/codex` → **Thinking & runtime override** tab → pick a target provider + model
- Subsequent requests through mimo2codex use this override transparently — Codex doesn't notice
- Reset via the same panel; cleared on restart.

## OAuth: Gitee / GitHub social login

### 1. Register the OAuth app

**GitHub**: <https://github.com/settings/applications/new>
- Homepage URL: `https://your-domain/`
- Authorization callback URL: `https://your-domain/oauth/callback/github`

**Gitee**: <https://gitee.com/oauth/applications/new>
- Callback URL: `https://your-domain/oauth/callback/gitee`
- Scope: tick `user_info`

> ⚠️ Gitee enforces HTTPS for callbacks. GitHub accepts http for local testing but production really should be HTTPS. For Docker deployments, run nginx / caddy in front for TLS termination.

### 2. Configure inside admin

Sign in as an admin → `/admin/account` → **OAuth providers (admin)**:

- Fill Client ID / Client secret / Callback URL
- Flip **Enabled** → Save
- Secrets are encrypted with the master key into `oauth_clients`. Editing later does not require re-entering the secret — leave it blank to preserve the existing ciphertext.

### 3. Users log in

Sign out, head back to `/admin/login`. Enabled providers appear as **Continue with GitHub** / **用 Gitee 登录** buttons.

Flow:

1. Click → 302 to the provider's authorize URL
2. After user consent, provider redirects to `/oauth/callback/<provider>?code=...&state=...`
3. mimo2codex validates state (10-minute single-use), exchanges code for access_token, fetches the user profile
4. No existing link → auto-creates a local user (`github_octo` / `gitee_<id>` style, no password)
5. Existing link → reuses the local user
6. Sets a session cookie, 302 to `/admin/`

> Repeated logins from the same GitHub / Gitee account always reuse the same local user (UNIQUE on provider + provider_user_id).

## Master key

The master key encrypts:

- Per-user BYOK upstream API keys
- OAuth client secrets

**Resolution order**:

1. `MIMO2CODEX_MASTER_KEY` env (base64 of 32 bytes) — **production recommended**, keeps the key off the same machine as the ciphertext
2. `<dataDir>/master.key` (hex of 32 bytes, mode `0o600`) — auto-generated on first start if the env is unset; logs a warning

Generate one:

```bash
# bash / zsh
openssl rand -base64 32

# PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Or just use node
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Wire it into `docker-compose.yml`:

```yaml
services:
  mimo2codex:
    environment:
      - MIMO2CODEX_MASTER_KEY=<the base64 string above>
```

> ⚠️ If you lose the master key (env not backed up AND `master.key` file gone), every BYOK / OAuth secret ciphertext becomes permanently unrecoverable. Don't commit `master.key` — your `~/.mimo2codex/` directory is already gitignored.

## Ops tips

- **Secure cookie**: behind HTTPS, set `MIMO2CODEX_COOKIE_SECURE=1` so the session cookie gets the `Secure` flag. Leave it off when testing over plain HTTP (browsers will refuse `Secure` cookies otherwise).
- **Bind host**: the Docker image defaults to `MIMO2CODEX_HOST=0.0.0.0`; the CLI defaults to `127.0.0.1`. To expose the CLI to a LAN, pass `--host 0.0.0.0` and **definitely** also `--auth on`.
- **Forgotten admin password**: log in as a different admin and patch the password from `/admin/users`. If the only admin's password is lost, stop the service and wipe the `users` table to re-trigger the first-run flow (next visit to `/admin/` will show the "create the initial admin" form again):
  ```bash
  sqlite3 ~/.mimo2codex/data.db "DELETE FROM users;"
  ```
- **Session pruning**: each request prunes expired sessions; for very-low-volume deployments (≤20 users) this is fine without a cron.

## Troubleshooting

**"I set `MIMO2CODEX_AUTH=on` but the admin UI still opens straight in / no login page"**

99% of the time this is env not being picked up. Walk through:

1. Check the startup log for `INFO auth: on` (and a **First-run admin setup needed** banner if the users table is still empty). **Missing ⇒ env didn't take effect.**
2. Confirm you set it in a place that actually loads:
   - ✅ Current shell session: `$env:MIMO2CODEX_AUTH = "on"` (PowerShell) or `export MIMO2CODEX_AUTH=on` (bash)
   - ✅ `~/.mimo2codex/.env` with `MIMO2CODEX_AUTH=on`
   - ❌ Repo-root `.env` — **not loaded**
3. Or just use the CLI flag: `npm run dev -- --auth on` — works regardless of env.

**"I'm logged in, but Codex still 401s"**

Server mode requires a bearer token on `/v1/*`. Check:

- Does `~/.codex/auth.json` have your `m2c_...` token created on `/admin/account`?
- Has the token been revoked since? (Check the **My API keys** list — `active` vs `revoked`)

**"OAuth callback returns 400 invalid or expired OAuth state"**

State tokens are valid for 10 minutes. If you clicked "Continue with GitHub", went to make coffee, and came back to authorize, it expired. Just start the flow again.

**"BYOK is set but requests still use the shared key"**

Walk through in order:

1. Inspect the upstream's audit log — what key prefix actually got used?
2. Check the `chat_logs` debug field `apiKeySource` (v0.2.16+ at debug log level)
3. Has the master key been rotated? Old ciphertext won't decrypt under a new master key, and the code silently falls back to the shared key. Re-enter the BYOK value to fix.
