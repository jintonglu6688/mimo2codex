# Publishing mimo2codex

Maintainer's runbook. If you're a user, you don't need this — just `npm install -g mimo2codex`.

---

## Release pipelines at a glance (v0.5.x+)

从 v0.5.0 起 mimo2codex 有**三条独立**的发版流水线，分别推**不同的 git tag** 触发。一次完整 GA 发版要推**两个** tag：`vX.Y.Z`（带动 npm + Docker）+ `vX.Y.Z-desktop`（带动 Win/Mac 桌面端打包）。

| Pipeline | Workflow file | 触发 tag pattern | 产出 |
|----------|---------------|-----------------|------|
| **npm** | `.github/workflows/publish.yml` | `v*`（排除 `v*-desktop*`） | 发包到 npmjs.com，按 SemVer 自动选 dist-tag（`latest` / `beta` / `rc` / ...）+ 创建 GitHub Release |
| **Docker** | `.github/workflows/docker.yml` | `v*.*.*`（排除 `v*-desktop*`）+ `push` 到 main/master | 推 multi-arch 镜像到 ghcr.io |
| **Desktop (Win / Mac)** | `.github/workflows/build-desktop.yml` | `v*-desktop` 或 `v*-desktop.N` | Electron 打包 `.exe` / `.zip`，上传到 GitHub Release |

### 完整 GA 发版流程（以 v0.5.4 为例）

```bash
# 1. 确认 working tree 干净、main 最新、所有 v0.5.4 commits 已合并
git status
git log --oneline origin/main..main

# 2. 推 npm + Docker tag → 触发 publish.yml 和 docker.yml
git push origin main
git tag v0.5.4
git push origin v0.5.4
# ↑ npm 自动发版（dist-tag=latest），Docker 镜像同时构建并推 ghcr.io

# 3. 推 desktop tag → 触发 build-desktop.yml
git tag v0.5.4-desktop
git push origin v0.5.4-desktop
# ↑ Win/Mac 桌面端打包，产物自动上传到对应的 GitHub Release
```

### Tag 命名速查

| Tag 形态 | 干什么 |
|----------|--------|
| `v0.5.4` | 正式 GA，npm + Docker |
| `v0.5.4-desktop` | v0.5.4 对应的桌面端打包（首次） |
| `v0.5.4-desktop.1` | v0.5.4 桌面端重打（修复 packaging bug 不动代码版本号） |
| `v0.5.5-beta.0` | npm pre-release，自动走 `dist-tag=beta`；不触发 desktop |
| `v0.5.5-beta.0-desktop` | beta 对应的桌面端打包（如果需要） |

### 备注

- **npm 和 Docker 是同一 tag（`v0.5.4`）驱动的** —— 一次推送，两个流水线并行跑。
- **桌面端**故意拆出 `-desktop` 后缀，是因为打包失败 / 测试 / 重传不应该让 npm 也跟着重发（npm 不允许重发同一个版本号）。一个 npm 版本可以对应多个桌面端 tag（`v0.5.4-desktop` / `v0.5.4-desktop.1` / `v0.5.4-desktop.2`）。
- **Docker 也会在 push 到 main 时构建**（不带 tag 也跑），这是 dev image；只有打 tag 推送时才生成对应版本号的 release image。
- **手动触发**：每个 workflow 都支持 `workflow_dispatch`，在 Actions UI 里能不动 tag 就跑（适合调试 / 重试）。
- **promote.yml** 是单独的：用于把已经发布的 npm 版本从一个 dist-tag 移到另一个（比如 `beta` → `latest`），不需要重新发版。详见下面"Tagging beta / next releases"小节。

---

## One-time setup

### 1. Confirm the package name is free

```bash
npm view mimo2codex
```

- If output ends with `404 Not Found` → the name is available
- If you see real package metadata → someone else owns it; rename the package in `package.json` (e.g. to a scoped name like `@7as0nch/mimo2codex`) before publishing

### 2. Log into npm

```bash
npm login                # opens browser for the new device-flow login
npm whoami               # should print your username (e.g. 7as0nch)
```

> **Strongly recommended**: enable 2FA at <https://www.npmjs.com/settings/~/profile> → Security. Pick **"Authorization and writes"** so it's required for `npm publish` too. Without 2FA, anyone who steals your npm token can push malware as you.

### 3. (Optional) Generate an npm automation token for CI

If you'll publish from GitHub Actions later: <https://www.npmjs.com/settings/~/tokens> → "Generate New Token" → **Automation** type. Add it as the `NPM_TOKEN` secret on the repo.

---

## Pre-flight check before every publish

Run from the repo root:

```bash
# 1. Make sure working tree is clean and on main
git status                 # should be clean
git pull --ff-only

# 2. Build + test (prepublishOnly will also do this, but fail fast here)
npm install
npm run build
npm test

# 3. See exactly what npm will ship — no surprises
npm pack --dry-run
```

The dry-run output should list **only**:

```
mimo2codex/dist/...                # compiled JS + sourcemaps
mimo2codex/mimoskill/...           # SKILL.md, scripts, references, assets
mimo2codex/AGENTS.md
mimo2codex/README.md
mimo2codex/README.zh.md
mimo2codex/LICENSE
mimo2codex/package.json
```

It should **NOT** include:

- ❌ `src/` (TypeScript source — only ship compiled output)
- ❌ `test/` (developer artifacts)
- ❌ `node_modules/`
- ❌ `.git*`, `tsconfig.json`, `vitest.config.ts` (npm hides these by default)
- ❌ `scripts/install.sh` / `install.ps1` (those are for git-clone bootstrapping; the npm consumer doesn't need them)

If you see something unexpected, fix the `files` array in `package.json`.

### 4. Smoke-test the tarball locally

Don't trust dry-run; install and run the actual tarball:

```bash
# Pack into a tarball
npm pack
# → produces mimo2codex-X.Y.Z.tgz

# Install it globally from the tarball (in a separate shell or scratch dir)
npm install -g ./mimo2codex-0.1.0.tgz

# Verify the binary works
mimo2codex --version
mimo2codex --help
mimo2codex print-config

# Clean up the global install before real publishing
npm rm -g mimo2codex
```

If anything goes sideways here it's MUCH less embarrassing than fixing it post-publish.

---

## First publish (0.1.0)

```bash
# Already at version 0.1.0 in package.json. If you want to bump first, do:
#   npm version patch       # 0.1.0 → 0.1.1
#   npm version minor       # 0.1.0 → 0.2.0
#   npm version major       # 0.1.0 → 1.0.0
# (these auto-commit + git tag)

npm publish
```

For an unscoped public package, that's it. If you renamed to a scoped package (`@7as0nch/mimo2codex`), you must add `--access public`:

```bash
npm publish --access public
```

If 2FA is on, npm will prompt for the OTP code.

After it lands:

- `npm view mimo2codex` should show your package
- `https://www.npmjs.com/package/mimo2codex` is live
- A fresh shell can run `npm install -g mimo2codex && mimo2codex --version`

---

## Subsequent releases

The `release:*` npm scripts in `package.json` chain version bump + publish + git push:

```bash
# Bug fix release
npm run release:patch       # 0.1.0 → 0.1.1, publish, push tag

# New feature, backwards-compatible
npm run release:minor       # 0.1.1 → 0.2.0

# Breaking change
npm run release:major       # 0.2.0 → 1.0.0
```

Each script does:
1. `npm version <patch|minor|major>` — bumps the version and creates a git tag
2. `npm publish` — `prepublishOnly` runs `npm run build && npm test` first (this will abort the publish if tests fail, which is what you want)
3. `git push --follow-tags` — sends the commit + tag to GitHub

> ⚠️ **Don't manually edit `version` in package.json.** Always use `npm version` so the git tag matches.

---

## Releasing a fix to an already-published version

You can't republish the same version — npm rejects it. Always bump:

```bash
# Pull, fix, commit
git pull
# ... edit code ...
git add -A && git commit -m "fix: stream-end edge case"

# Then bump-and-publish in one go
npm run release:patch
```

If you accidentally publish a broken version:

- **Within 72 hours**: `npm unpublish mimo2codex@X.Y.Z` (npm allows this for new packages)
- **After 72 hours**: `npm deprecate mimo2codex@X.Y.Z "reason"` — the version stays installable but new users see a warning. Then publish a fix as a higher version.

Avoid republishing the same version — npm intentionally won't let you (it would break anyone who already has X.Y.Z installed by changing what they get on `npm install`).

---

## Tagging beta / next releases (recommended: GitHub workflow)

The `.github/workflows/publish.yml` automation **detects pre-release versions from SemVer** and picks the right npm dist-tag for you. You don't need to remember `--tag beta`.

### Flow

1. **Cut a beta locally:**

   ```bash
   # First beta off a stable base (0.2.4 → 0.2.5-beta.0):
   #   first run `npm version prepatch --preid beta --no-git-tag-version`
   #   then commit + tag manually, OR use `npm run release:beta` AFTER
   #   bumping to a prerelease state once.
   #
   # Subsequent betas (0.2.5-beta.0 → 0.2.5-beta.1):
   pnpm release:beta              # increments prerelease counter + commit + tag + push
   ```

   `release:beta` runs `node scripts/release.mjs prerelease --preid beta` —
   semver-correct, doesn't fight `release:patch` (which would strip the
   prerelease and go straight to stable).

2. **Workflow auto-detects the `-beta.0` suffix** and publishes to npm with `dist-tag = beta`. The corresponding GitHub Release is marked **Pre-release**.

   - Version → dist-tag mapping (auto):
     - `0.2.5-beta.0`  → `beta`
     - `0.2.5-alpha.3` → `alpha`
     - `0.3.0-rc.1`    → `rc`
     - `0.2.5`         → `latest`

3. **Users install** the beta with:

   ```bash
   npm i -g mimo2codex@beta
   ```

   `npm i -g mimo2codex` (no `@beta`) still gets the latest stable.

4. **Promote to latest** when ready, two options:

   - **(A) Cut a new stable tag** (most common — there's been more work since the beta):

     ```bash
     npm version 0.2.5
     git push --follow-tags
     ```

     Workflow auto-picks `dist-tag = latest` and a regular GitHub Release.

   - **(B) Promote the exact beta artifact** without republishing (when 0.2.5-beta.0 IS what you want shipped as 0.2.5 stable — same bits, same tarball):

     GitHub → **Actions → "Promote npm dist-tag" → Run workflow**:

     - `version`: `0.2.5-beta.0`
     - `target_tag`: `latest`
     - `remove_old_tag`: `beta` (optional — clears the stale beta pointer)

     Runs `npm dist-tag add mimo2codex@0.2.5-beta.0 latest` server-side using the repo's `NPM_TOKEN`. No 2FA prompt.

### Manual overrides (workflow_dispatch on publish.yml)

You can run `publish.yml` manually with overrides if the auto detection is wrong for a specific case:

- `dist_tag`: defaults to `auto`. Force `latest` / `beta` / `next` / `canary` / etc.
- `prerelease`: defaults to `auto`. Force `true` / `false` for the GitHub Release flag.

Note: `workflow_dispatch` runs against the default branch — version in `package.json` at that point is what gets published. Usually you tag first, then dispatch on the tag ref via Actions UI.

---

## Troubleshooting

**`npm publish` says "402 Payment Required"**
You're trying to publish a scoped package without `--access public`. Either:
- Add `"publishConfig": { "access": "public" }` to package.json, or
- Run `npm publish --access public`

**`npm publish` says "403 Forbidden — you do not have permission"**
- `npm whoami` to confirm you're logged in as the right user
- `npm view mimo2codex` to see who currently owns the name (might be different)
- If it's your old account, `npm logout && npm login` to switch

**`npm publish` says "EOTP — One-time password required"**
You have 2FA enabled. Pass `--otp=XXXXXX` or it'll prompt interactively.

**The published package is missing files**
- `npm pack --dry-run` to see what was included
- Update the `files` array in `package.json`
- Bump version and republish (you can't change a published version)

**The published package has way too many files**
Same fix path. By default npm includes everything not in `.gitignore` / `.npmignore` if `files` isn't set. Always set `files`.

**`bin` script doesn't run on macOS / Linux after install**
- Verify `dist/cli.js` has the shebang `#!/usr/bin/env node` as line 1 (`src/cli.ts` already does, tsc preserves it)
- Verify the `bin` field in package.json: `"mimo2codex": "dist/cli.js"`
- npm sets the +x bit automatically on install — if it didn't, the package was built incorrectly

**`bin` script doesn't run on Windows after install**
- npm creates a `mimo2codex.cmd` shim automatically; works in both PowerShell and CMD
- If `mimo2codex` isn't found: confirm `%APPDATA%\npm\` is in your PATH (it is by default after Node.js install)

---

## What gets shipped (current `files` list)

| Path | Why it's included |
|---|---|
| `dist/` | Compiled JS the binary actually runs |
| `mimoskill/` | Helper scripts users can invoke (e.g. `node $(npm root -g)/mimo2codex/mimoskill/scripts/generate_pet.py`) |
| `AGENTS.md` | Codex-agent instructions; useful if user copies into their own repo |
| `README.md` | Shown on npmjs.com |
| `README.zh.md` | Chinese docs |
| `LICENSE` | Required for permissive use |
| `package.json` | Always shipped automatically |

If you decide `mimoskill/` shouldn't ship via npm (e.g. it grows large), remove it from `files`. Users who installed via git clone will still have it.

---

## Useful commands cheat sheet

```bash
npm view mimo2codex                  # see published metadata
npm view mimo2codex versions         # list all published versions
npm view mimo2codex@latest           # latest tagged version
npm view mimo2codex dist-tags        # show all dist-tags

npm unpublish mimo2codex@X.Y.Z       # within 72 hours of publish
npm deprecate mimo2codex@X.Y.Z "msg" # mark deprecated forever

npm pack                             # produce tarball without publishing
npm pack --dry-run                   # list what would ship

npm version patch                    # 0.1.0 → 0.1.1 + git tag
npm version minor                    # 0.1.0 → 0.2.0 + git tag
npm version major                    # 0.1.0 → 1.0.0 + git tag

npm dist-tag ls mimo2codex           # list dist-tags
npm dist-tag add mimo2codex@X.Y.Z latest    # promote a beta to latest
```
