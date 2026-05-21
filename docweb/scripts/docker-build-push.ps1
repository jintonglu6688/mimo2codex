<#
.SYNOPSIS
  Build the mimo2codex-docweb image and push it to Docker Hub.

.DESCRIPTION
  Uses Docker Buildx to produce multi-arch Linux images (amd64 + arm64 by
  default) from a Windows host. Docker Desktop's WSL2 backend handles the
  Linux runtime; QEMU emulation handles the arm64 cross-build.

  Assumptions
    * `docker login` has already been done.
    * Run from anywhere — the script resolves paths relative to itself.

.PARAMETER Username
  Docker Hub username (image namespace). Falls back to $env:DOCKERHUB_USERNAME.

.PARAMETER Repo
  Repository name on Docker Hub. Default: mimo2codex-docweb.

.PARAMETER Tags
  Tags to apply. Default (when omitted): the version read from the repo-root
  package.json (e.g. "0.4.2") + "latest". A `sha-<short>` tag is always auto-
  appended when invoked inside a git checkout, regardless of -Tags.

  Why both: a semver tag (0.4.2) is what your k8s / docker-compose manifest
  should pin to so updates trigger a rollout; `latest` is for casual
  `docker run` users. If you only want one of them, pass -Tags explicitly.

.PARAMETER Platforms
  Target platforms (comma list in buildx form). Default: linux/amd64,linux/arm64.

.PARAMETER NoPush
  Build only — don't push. Combined with --load makes the image available
  locally for `docker run`.

.PARAMETER LoadLocal
  Single-arch build that loads the result into the local Docker daemon
  (overrides Platforms to the host arch). Useful for smoke-testing.

.EXAMPLE
  # Default: tags = <package.json version>, latest, sha-<short>
  pwsh docweb/scripts/docker-build-push.ps1

.EXAMPLE
  # Local smoke test, no push
  pwsh docweb/scripts/docker-build-push.ps1 -LoadLocal -NoPush

.EXAMPLE
  # Override the auto-detected version with explicit tags
  pwsh docweb/scripts/docker-build-push.ps1 -Tags 0.4.2,latest

.EXAMPLE
  # Only the semver tag, no 'latest' (recommended for production releases)
  pwsh docweb/scripts/docker-build-push.ps1 -Tags 0.4.2
#>

[CmdletBinding()]
param(
  [string]$Username = $env:DOCKERHUB_USERNAME,
  [string]$Repo = "mimo2codex-docweb",
  [string[]]$Tags = @(),
  [string]$Platforms = "linux/amd64,linux/arm64",
  [switch]$NoPush,
  [switch]$LoadLocal
)

$ErrorActionPreference = "Stop"

function Get-DockerHubUsername {
  $configPath = Join-Path $env:USERPROFILE ".docker\config.json"
  if (-not (Test-Path $configPath)) { return $null }

  try {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }

  $hubKeys = @("https://index.docker.io/v1/", "index.docker.io", "docker.io")

  # 1) Credential helper path (Docker Desktop's default on Windows uses `desktop`).
  $store = $config.credsStore
  if (-not $store -and $config.credHelpers) {
    foreach ($k in $hubKeys) {
      $h = $config.credHelpers.$k
      if ($h) { $store = $h; break }
    }
  }
  if ($store) {
    $helper = "docker-credential-$store"
    foreach ($k in $hubKeys) {
      try {
        $json = $k | & $helper get 2>$null
        if ($LASTEXITCODE -eq 0 -and $json) {
          $parsed = $json | ConvertFrom-Json -ErrorAction Stop
          if ($parsed.Username) { return [string]$parsed.Username }
        }
      } catch {
        # next key
      }
    }
  }

  # 2) Plaintext auth entry fallback.
  if ($config.auths) {
    foreach ($k in $hubKeys) {
      $entry = $config.auths.$k
      if ($entry -and $entry.auth) {
        try {
          $bytes = [Convert]::FromBase64String([string]$entry.auth)
          $decoded = [System.Text.Encoding]::UTF8.GetString($bytes)
          $name = $decoded.Split(':', 2)[0]
          if ($name) { return $name }
        } catch {
          # next
        }
      }
    }
  }

  return $null
}

if (-not $Username) {
  $Username = Get-DockerHubUsername
  if ($Username) {
    Write-Host "Detected Docker Hub username from local credentials: $Username" -ForegroundColor DarkGray
  }
}

if (-not $Username) {
  throw @"
Could not detect Docker Hub username automatically.
  • Run ``docker login`` first, OR
  • Pass -Username <name>, OR
  • Set `$env:DOCKERHUB_USERNAME.
"@
}

# ── Resolve paths relative to this script ──────────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$dockerfile = (Resolve-Path (Join-Path $scriptDir "..\Dockerfile")).Path

# ── Default Tags from repo-root package.json `version` ─────────────────────
# Without this, every push collapses onto `:latest` and k8s manifests pinning
# to it have no signal that the image actually changed. A semver tag lets
# operators bump their manifest from 0.4.1 → 0.4.2 and trigger a rolling
# update on the next reconcile.
function Get-ProjectVersion {
  param([string]$RootDir)
  $pkgPath = Join-Path $RootDir "package.json"
  if (-not (Test-Path $pkgPath)) { return $null }
  try {
    $obj = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if ($obj.version) { return [string]$obj.version }
  } catch {
    # malformed package.json — fall through
  }
  return $null
}

$tagsExplicit = $PSBoundParameters.ContainsKey('Tags') -and $Tags.Count -gt 0
if (-not $tagsExplicit) {
  $autoVersion = Get-ProjectVersion -RootDir $repoRoot
  if ($autoVersion) {
    $Tags = @($autoVersion, "latest")
    Write-Host "Auto-detected version from package.json: $autoVersion" -ForegroundColor DarkGray
  } else {
    $Tags = @("latest")
    Write-Host "No package.json version detected — tagging 'latest' only" -ForegroundColor Yellow
  }
}

# ── Always append git short SHA for audit trail ────────────────────────────
$gitSha = $null
Push-Location $repoRoot
try {
  $sha = & git rev-parse --short HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $sha) {
    $gitSha = $sha.Trim()
  }
} catch {
  # git not installed or not a repo — skip
} finally {
  Pop-Location
}
if ($gitSha) { $Tags = @($Tags + "sha-$gitSha") | Select-Object -Unique }

$imageBase = "${Username}/${Repo}"
$tagArgs = @()
foreach ($t in $Tags) { $tagArgs += @("--tag", "${imageBase}:${t}") }

Write-Host ""
Write-Host "▶ Building $imageBase" -ForegroundColor Cyan
Write-Host "  Tags:      $($Tags -join ', ')"
Write-Host "  Platforms: $Platforms"
Write-Host "  Context:   $repoRoot"
Write-Host "  Dockerfile: $dockerfile"
Write-Host ""

# ── Ensure buildx + a builder ──────────────────────────────────────────────
& docker buildx version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "docker buildx is not available. Make sure Docker Desktop is running."
}

$builderName = "m2cx-builder"
$builders = & docker buildx ls 2>&1
if (-not ($builders -match $builderName)) {
  Write-Host "Creating buildx builder '$builderName'…" -ForegroundColor Yellow
  & docker buildx create --name $builderName --driver docker-container --use --bootstrap | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create buildx builder" }
} else {
  & docker buildx use $builderName | Out-Null
}

# ── Assemble buildx args ───────────────────────────────────────────────────
$buildArgs = @(
  "buildx", "build",
  "--file", $dockerfile,
  "--pull"
)

if ($LoadLocal) {
  if ($Platforms -match ",") {
    Write-Warning "Multi-platform with --load is not supported. Falling back to host arch only."
  }
  $hostArch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") {
    "linux/arm64"
  } else {
    "linux/amd64"
  }
  $buildArgs += @("--platform", $hostArch, "--load")
} else {
  $buildArgs += @("--platform", $Platforms)
  if (-not $NoPush) {
    $buildArgs += "--push"
  }
}

$buildArgs += $tagArgs
$buildArgs += $repoRoot

Write-Host "→ docker $($buildArgs -join ' ')" -ForegroundColor DarkGray
Write-Host ""
& docker @buildArgs
if ($LASTEXITCODE -ne 0) {
  throw "docker buildx failed (exit $LASTEXITCODE)"
}

Write-Host ""
Write-Host "✓ Done" -ForegroundColor Green
if (-not $NoPush -and -not $LoadLocal) {
  foreach ($t in $Tags) {
    Write-Host "  pushed: ${imageBase}:${t}" -ForegroundColor Green
  }
  Write-Host ""
  Write-Host "Run anywhere:" -ForegroundColor Cyan
  Write-Host "  docker run --rm -p 8080:80 ${imageBase}:$($Tags[0])"
} elseif ($LoadLocal) {
  Write-Host "Loaded locally. Try:" -ForegroundColor Cyan
  Write-Host "  docker run --rm -p 8080:80 ${imageBase}:$($Tags[0])"
}
