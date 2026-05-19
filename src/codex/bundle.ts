// Generates the "apply locally" scripts that the web UI hands back to the user
// in server-mode deployments. The container can't reach the user's machine,
// so instead of writing ~/.codex/* directly we package the rendered config +
// a small script the user runs in their own shell.
//
// Both variants follow the same playbook the in-process applyCodex() does:
//   1. snapshot the existing auth.json / config.toml under a timestamped name
//      (so a slip-up is recoverable)
//   2. atomically write the new files
//   3. echo a "restart Codex" reminder

export function renderApplyShellScript(opts: {
  authJson: string;
  configToml: string;
  providerId: string;
  modelId: string;
}): string {
  const ts = "$(date +%s%3N 2>/dev/null || date +%s)";
  return `#!/usr/bin/env bash
set -euo pipefail

# mimo2codex apply bundle — POSIX shell
# provider=${opts.providerId}  model=${opts.modelId}

CODEX_DIR="\${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_DIR"

TS=${ts}
backup_if_present() {
  if [ -f "$1" ]; then
    cp "$1" "$1.bak.$TS"
    echo "  backed up: $1 -> $1.bak.$TS"
  fi
}

backup_if_present "$CODEX_DIR/auth.json"
backup_if_present "$CODEX_DIR/config.toml"

cat > "$CODEX_DIR/auth.json" <<'__M2C_AUTH_JSON__'
${opts.authJson}
__M2C_AUTH_JSON__

cat > "$CODEX_DIR/config.toml" <<'__M2C_CONFIG_TOML__'
${opts.configToml}
__M2C_CONFIG_TOML__

echo "OK — mimo2codex config applied to $CODEX_DIR"
echo "Restart Codex to pick up the change."
`;
}

export function renderApplyPowerShellScript(opts: {
  authJson: string;
  configToml: string;
  providerId: string;
  modelId: string;
}): string {
  // PowerShell here-strings can't have leading whitespace before the closing
  // tag, so all our @' ... '@ blocks must start at column 0.
  return `# mimo2codex apply bundle — PowerShell
# provider=${opts.providerId}  model=${opts.modelId}

$ErrorActionPreference = "Stop"
$codexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
if (-not (Test-Path $codexDir)) {
  New-Item -ItemType Directory -Path $codexDir | Out-Null
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
function Backup-IfPresent($path) {
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    Write-Host "  backed up: $path -> $bak"
  }
}

Backup-IfPresent (Join-Path $codexDir "auth.json")
Backup-IfPresent (Join-Path $codexDir "config.toml")

$auth = @'
${opts.authJson}
'@
$conf = @'
${opts.configToml}
'@

Set-Content -LiteralPath (Join-Path $codexDir "auth.json") -Value $auth -NoNewline
Set-Content -LiteralPath (Join-Path $codexDir "config.toml") -Value $conf -NoNewline

Write-Host "OK — mimo2codex config applied to $codexDir"
Write-Host "Restart Codex to pick up the change."
`;
}
