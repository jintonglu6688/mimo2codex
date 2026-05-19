// Initial schema. Kept inline (rather than as a .sql file alongside the
// compiled .js) so packaging doesn't have to chase asset paths. Future
// migrations should append numbered statements to MIGRATIONS and bump the
// schema version checked at startup.

export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  shortcut TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  api_key_env TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  display_name TEXT,
  supports_images INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  supports_web_search INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  deprecated_after TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_id, upstream_id)
);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id, sort_order);

CREATE TABLE IF NOT EXISTS model_aliases (
  alias TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  request_id TEXT,
  provider_id TEXT NOT NULL,
  client_model TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  stream INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_snippet TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_ts ON chat_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_provider ON chat_logs(provider_id, ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE chat_logs ADD COLUMN request_body TEXT;
ALTER TABLE chat_logs ADD COLUMN response_body TEXT;
ALTER TABLE chat_logs ADD COLUMN tool_call_count INTEGER;
`,
  },
  {
    // Capture upstream prompt-cache hits so the dashboard can plot a
    // "cache hit ratio" trend alongside the token usage chart. MiMo and
    // DeepSeek both report this as usage.prompt_tokens_details.cached_tokens
    // (Chat Completions) / usage.input_tokens_details.cached_tokens
    // (Responses); we already parse both fields in translate/* but never
    // persisted them.
    version: 3,
    sql: `
ALTER TABLE chat_logs ADD COLUMN cached_tokens INTEGER;
`,
  },
  {
    // Auth & multi-user layer. Tables exist unconditionally; whether they're
    // populated/enforced depends on cfg.authMode ("off" leaves them empty,
    // "on" wires them into the request pipeline). user_id columns on
    // shared resources (codex_config_history) are nullable to represent
    // local-mode rows that don't belong to any specific account.
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);

CREATE TABLE IF NOT EXISTS user_oauth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  avatar_url TEXT,
  linked_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_upstream_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS codex_config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  auth_json TEXT NOT NULL,
  config_toml TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_codex_history_user_ts ON codex_config_history(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_codex_history_kind ON codex_config_history(user_id, kind);

CREATE TABLE IF NOT EXISTS oauth_clients (
  provider TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  client_secret_nonce TEXT NOT NULL,
  client_secret_auth_tag TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bootstrap_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'bootstrap',
  payload TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bootstrap_tokens_purpose ON bootstrap_tokens(purpose, expires_at);
`,
  },
  {
    // v5: per-request user attribution on chat_logs. Lets the Users admin page
    // join chat_logs → users for "request count / total tokens / last seen"
    // stats. NULL means the request came in under local mode (no user) or
    // through an anonymous path; the admin UI surfaces those as "anonymous".
    version: 5,
    sql: `
ALTER TABLE chat_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON chat_logs(user_id, ts DESC);
`,
  },
];
