# Control Codex from your phone (keep ChatGPT login + proxy)

<p>
  <a href="./codex-mobile-remote.md"><strong>English</strong></a> ·
  <a href="./codex-mobile-remote.zh.md">简体中文</a>
</p>

This guide explains how to keep your real **"Sign in with ChatGPT"** login active while the
model still runs through mimo2codex — so you can use OpenAI's official **Codex mobile / remote**
feature (drive this computer's Codex from your phone) backed by a MiMo / DeepSeek / generic model.

## What this is — and what it isn't

- **mimo2codex does NOT implement the remote relay.** The "control Codex from your phone" relay is
  OpenAI's own infrastructure (a secure relay between your phone's ChatGPT app and the Codex desktop
  app on this computer). mimo2codex can't change it.
- **mimo2codex's job here is narrow:** keep your ChatGPT login intact (so the official feature keeps
  working) while redirecting only the *model backend* to the local proxy.

## Why the "keep login" mode exists

Enabling a mimo2codex provider used to **overwrite** `~/.codex/auth.json` with a placeholder key,
which logs you out of "Sign in with ChatGPT". That made the official login and the proxy mutually
exclusive. The **keep-login** apply mode leaves `auth.json` byte-for-byte untouched and only rewrites
`config.toml`.

## Steps

1. **Sign in to ChatGPT in Codex.** Run `codex login` (Sign in with ChatGPT) on this computer, or make
   sure you're already logged in.
2. **Enable a model with "keep login".** Open the admin **Codex Enable** page (`/admin/codex`) and
   apply a provider/model. When a real login is detected, mimo2codex **keeps it by default** and only
   redirects the model. (The confirm dialog explains this; a checkbox lets you opt into the old
   overwrite instead.)
3. **Set up Codex mobile in the desktop app.** In Codex desktop, open **"Set up Codex mobile"** and
   scan the QR code from the ChatGPT app on your phone — both must use the **same OpenAI account**.
4. **Drive tasks from your phone.** Start and approve tasks from the phone; code, files and shell run
   on *this* computer, now backed by your mimo2codex provider.

## How it works under the hood

The keep-login mode writes a `config.toml` like the normal flow:

```toml
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

`requires_openai_auth = true` tells Codex to attach your credentials as the bearer **to this
provider's `base_url`** — i.e. to the local proxy, not to OpenAI. Because `auth.json` still holds your
real ChatGPT OAuth token, Codex sends that token to mimo2codex, which **ignores inbound credentials**
and forwards the request to your real upstream (MiMo / DeepSeek / …). Your ChatGPT login is never
touched, so the account state the official mobile/remote relay depends on stays valid.

> Local default is `MIMO2CODEX_AUTH=off`, so `/v1/*` doesn't validate the inbound bearer — the real
> ChatGPT token simply passes through and is dropped. (In `auth=on` deployments `/v1/*` expects an
> `m2c_` bearer, which is a different, server-mode setup.)

## ⚠️ Caveat — the remote combination is best-effort

Whether OpenAI's **remote** mode actually runs the model through your local proxy (versus forcing its
own models server-side) is **not documented**. The local Codex on this computer uses your `config.toml`
and *does* route to the proxy; the open question is purely about the phone-driven remote path.

**Verify it yourself:** after driving a task from your phone, check the mimo2codex logs (or the admin
**Logs** page) and confirm the request actually hit the proxy. If it didn't, the remote path is using
OpenAI's own backend regardless of your local config — that's an OpenAI-side limitation, not a
mimo2codex bug.

## Related

- Manual config snippets (including the **"Keep ChatGPT login"** config-only variant) live on the
  admin **Codex Enable** page, in the prerequisites panel.
- For the overwrite-based flows and backups, see [codex-enable.md](./codex-enable.md).
