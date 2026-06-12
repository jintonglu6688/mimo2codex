// "Preserve login" snippet — the config.toml-only variant for users who want to
// keep their real "Sign in with ChatGPT" session alive (so OpenAI's official
// Codex mobile/remote feature keeps working) while still routing the model
// backend through the local mimo2codex proxy.
//
// Unlike configSnippet() in snippets.ts, this one deliberately does NOT ship an
// auth.json block: the user's existing ~/.codex/auth.json (their ChatGPT OAuth
// token) must stay exactly as `codex login` wrote it. Codex attaches that token
// as the bearer to the proxy via `requires_openai_auth = true`; the proxy
// ignores inbound credentials and forwards upstream.
//
// Kept in its own file so the existing snippet variants are untouched.

import {
  alternativesComment,
  modelTuningLines,
  providerTableBlock,
  type HostPort,
  type SnippetTarget,
} from "./snippets.js";

export function configSnippetPreserveLogin(cfg: HostPort, target: SnippetTarget): string {
  return `# Preserve-login variant — keep your "Sign in with ChatGPT" session.
# DO NOT touch ~/.codex/auth.json. Leave your existing ChatGPT OAuth login in
# place so OpenAI's official Codex mobile/remote feature keeps working. Only the
# model backend is redirected to the local mimo2codex proxy below.

# Append / merge into ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml)
model = "${target.modelId}"
model_provider = "${target.providerKey}"${modelTuningLines(target)}

${alternativesComment(target)}

${providerTableBlock(cfg, target)}

# Then completely quit and restart Codex. Your ChatGPT login is untouched; the
# model now routes through mimo2codex. (To control this Codex from your phone,
# set up OpenAI's official "Codex mobile" in the Codex desktop app — it needs
# the very login this variant preserves.)
`;
}
