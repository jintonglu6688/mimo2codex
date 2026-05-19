# 鉴权与多用户部署

mimo2codex 默认是"本地零鉴权代理"——单机起一份、Codex 直连，没有用户/密码/接口 key。

从 v0.2.16 开始多了一档运行模式：**Server 模式**。当你想把 mimo2codex 部署到 Docker / 内网 / 给小圈子朋友共享时打开它，加上：

- 登录系统（本地账号 + 可选 Gitee / GitHub OAuth）
- 代理接口加 bearer token 鉴权（防外人白嫖你的 key）
- 每用户可填自己的上游 key（BYOK），加密存储
- Codex 客户端配置历史 + 一键导出 bundle（容器里写不到你本机 ~/.codex，所以下发文件 + 脚本由你本地执行）

> 💡 **本地单机用户不受影响**——`authMode` 默认 `off`，所有现有 UX 都跟以前一模一样。下面任何步骤都只对开启 Server 模式的部署有意义。

## 目录

- [快速对比](#快速对比)
- [启用 Server 模式](#启用-server-模式)
  - [本地开发（dev / npm 全局）](#本地开发dev--npm-全局)
  - [Docker 部署](#docker-部署)
- [首次启动：创建首位管理员](#首次启动创建首位管理员)
- [登录与日常使用](#登录与日常使用)
- [代理接口鉴权（给 Codex 用）](#代理接口鉴权给-codex-用)
- [BYOK：用户自带上游 key](#byok用户自带上游-key)
- [Codex 配置同步与历史](#codex-配置同步与历史)
- [OAuth：Gitee / GitHub 三方登录](#oauthgitee--github-三方登录)
- [主密钥 (Master Key)](#主密钥-master-key)
- [运维提示](#运维提示)
- [故障排查](#故障排查)

## 快速对比

| 维度 | 本地模式 (默认 `authMode=off`) | Server 模式 (`authMode=on`) |
|---|---|---|
| 登录 | 不需要 | 浏览器走 `/admin/login` 或 OAuth |
| `/v1/*` 鉴权 | 全开 | 必须 `Authorization: Bearer m2c_...` |
| `/admin/*` 鉴权 | 全开 | session cookie，未登录跳登录页 |
| 上游 key 来源 | env / .env | env / .env（共享）+ 每用户 BYOK（覆盖） |
| Codex 配置写盘 | 直接写 `~/.codex/` | 不写；下发 bundle + 脚本由用户本机执行 |
| Docker 镜像默认 | — | **已默认开启**（Dockerfile 里 `ENV MIMO2CODEX_AUTH=on`） |

## 启用 Server 模式

**最关键的一条**：mimo2codex 只自动加载 `~/.mimo2codex/.env`（数据目录下的 `.env`），**不会加载项目根目录的 `.env`**。把 `MIMO2CODEX_AUTH=on` 写到项目根 `.env` 没用。

### 本地开发（dev / npm 全局）

按从易到难任选其一：

**1. 命令行直接传 flag（最直接）**

```powershell
# Windows PowerShell
npm run dev -- --auth on

# macOS / Linux
npm run dev -- --auth on
```

`npm` 把 `--` 后面的参数转给底层 `tsx src/cli.ts`，CLI 解析到 `--auth on` 后 `authMode=on`。

**2. shell 环境变量**

```powershell
# PowerShell
$env:MIMO2CODEX_AUTH = "on"
npm run dev

# bash / zsh
export MIMO2CODEX_AUTH=on
npm run dev
```

注意：env 仅在当前终端有效，新开终端要重设。

**3. 写到 `~/.mimo2codex/.env`（持久化）**

```bash
# 如果文件不存在先 init 一次
node dist/cli.js init    # 或 mimo2codex init（已全局安装时）

# 然后编辑 ~/.mimo2codex/.env，加一行：
MIMO2CODEX_AUTH=on
```

下次 `npm run dev` / `mimo2codex` 都会自动加载这一项。如果想关掉，注释或删掉这一行即可。

> 想确认到底有没有生效？看启动日志，开了 Server 模式时会打印一行 `INFO auth: on — admin login required`；users 表为空时还会打印一段 **First-run admin setup needed** 横幅指向 `http://<host>:<port>/admin/`。看到就是开了，没看到就是 `authMode=off`。

### Docker 部署

Docker 镜像已经默认 `MIMO2CODEX_AUTH=on`，不需要做任何额外操作。

```bash
docker compose up -d
# 直接打开浏览器即可，不用 docker logs：
open http://localhost:8788          # mac / Linux
start http://localhost:8788         # Windows
```

如果出于某种原因你想在 Docker 里关掉鉴权（**不推荐**，等于把上游 key 暴露给任何能访问到容器端口的人）：

```yaml
# docker-compose.yml
services:
  mimo2codex:
    environment:
      - MIMO2CODEX_AUTH=off
```

## 首次启动：创建首位管理员

启动后直接在浏览器打开 `http://<host>:8788/admin/`，SPA 检测到 `users` 表是空的，自动跳到 **首次启动初始化** 页面：

- **管理员账号**：随便起个名字（如 `root` / `admin`）
- **显示名**：可空，默认与账号一致
- **密码**：至少 8 位

点提交，服务端做三件事：

1. 再次校验 users 表仍为空（拿到 200 就是第一个 admin）
2. 创建账号到 `users` 表，标记 `is_admin = 1`
3. 发 session cookie，自动登录到 `/admin/`

跟 Jellyfin / Nextcloud / 群晖 一样的首次部署流程——**谁先开浏览器谁是 admin**。控制台/docker logs 一个字都不需要看。

### Docker 用户的零摩擦流程

```bash
docker compose up -d
open http://localhost:8788          # mac / Linux
start http://localhost:8788         # Windows
```

不需要 `docker logs`、不需要 `docker exec`、不需要拷贝 token。

> ⚠️ **安全前提**：这套流程假设你部署到 firewall / 反代背后或私有网络，外部流量到达 mimo2codex 之前你已经先抢到了。如果直接把端口暴露到公网，请确保启动后立刻打开浏览器创建 admin——否则任何能够访问到端口的人都能成为 admin。需要更严格的 0day 防护可以反代上加一层 IP 白名单。

## 登录与日常使用

首位 admin 创建完之后，下次访问 `/admin/` 就会跳到 `/admin/login`。填账号密码登录即可。session 默认 7 天，无操作不滑动，有操作每次自动续期。

登录后左侧导航里：

- **我的账户**：跳到 `/admin/account`，管自己的代理 API key、BYOK 上游 key、第三方账号绑定。所有用户可见
- **用户管理**：跳到 `/admin/users`，看全部用户 + 用量统计 + 启用/禁用 + 角色调整 + 公开注册开关。仅管理员可见

页面右上角的用户菜单是个快速入口，里面也有"我的账户"和"退出登录"。

管理员还能在 `/admin/account` 底部看到 **OAuth 配置** 卡片，给 Gitee / GitHub 填 client_id / secret / callback URL。

公开注册开关在 `/admin/users` 顶部，默认 OFF。打开后任何人都能去 `/admin/register` 自助注册；关闭则只能由管理员从「用户管理」页面创建账号。

## 代理接口鉴权（给 Codex 用）

Server 模式下，所有 `/v1/responses` 和 `/v1/chat/completions` 请求都需要 bearer token：

```
Authorization: Bearer m2c_<64 hex>
```

token 怎么来：

1. 登录后到 `/admin/account` → **我的 API Key** 卡片
2. 起个名字（如 `laptop` / `codex-cli`），点 **新建 Key**（留空也会自动用时间戳命名）
3. 弹出的 token 只展示这一次——**立即复制**，关了就再也找不到了
4. 用这个 token 填到 Codex 配置里（替代原 `mimo2codex-local` 占位）

### Codex 端配置

`~/.codex/auth.json`：

```json
{ "OPENAI_API_KEY": "m2c_<你的 token>" }
```

`~/.codex/config.toml` 里 base_url 改成你的服务地址（默认 `http://127.0.0.1:8788/v1`，Docker 部署改为 `http://<host>:8788/v1` 或带域名的 https）。

> 不想手撕文件？去 `/admin/codex` 顶部「当前状态」卡片右上角点 **导出到本地**，会下载 `auth.json` + `config.toml` + 一个本机执行的小脚本。下面 [Codex 配置导入 / 导出](#codex-配置导入--导出) 一节有完整流程。

## BYOK：用户自带上游 key

到 `/admin/account` → **My upstream keys (BYOK)**，每个 provider 一行：

- 没设置时：显示 *Using deployment-shared key*，请求会用部署者放在 env 里的全局 key
- 点 **Set BYOK** → 填进你自己的 MiMo / DeepSeek / 自定义上游 key → 保存
- 设了之后：你发起的请求都用你自己的 key 跑，账单也算你头上；其他用户互不影响

**加密存储**：所有 BYOK key 在 SQLite 里是 AES-256-GCM 密文，主密钥见下文 [主密钥](#主密钥-master-key) 一节。Web UI 永远不会再次展示明文，所以请保管好原始 key（你自己平台上还能再生成一份）。

**回退逻辑**：当主密钥被换掉、解密失败时，请求会**静默回退到共享 key**（不会 500），但用户需要重新填一次 BYOK。

## Codex 配置导入 / 导出

页面 `/admin/codex` → **当前状态** 卡片右上有两个按钮，三种用法：

### 导出到本地（"我配置好了，要拷贝到我本地的 Codex"）

1. 点 **导出到本地** → 弹出教程模态
2. 模态里完整列出步骤 + m2c key 提示，**确认下载**前不会有任何文件传输
3. 点 **确认下载 4 个文件**：浏览器下载 `auth.json`、`config.toml`、`apply-*.sh`、`apply-*.ps1` 到默认下载目录
4. **Server 模式下**：下载的 `auth.json` 里 `OPENAI_API_KEY` 字段是占位符 `mimo2codex-local`——这不是可用的 key。需要：
   - 去 `/admin/account` → **我的 API Key** 新建一把 key
   - 复制弹出的 m2c key 明文（创建时仅显示一次）
   - 打开下载的 `auth.json`，把 `mimo2codex-local` 替换为该 m2c key
5. **本地模式下**：占位符可以保留——本地 `/v1/*` 不做鉴权，Codex 拿什么字符串过来都行
6. 把 4 个文件放到同一个目录，本机执行：
   - Mac/Linux：`bash apply-xxx.sh`
   - Windows：`powershell -ExecutionPolicy Bypass -File apply-xxx.ps1`
7. 脚本会自动备份你本机现有的 `~/.codex/auth.json|config.toml` 为 `*.bak.<时间戳>`，然后写入新文件
8. 重启 Codex（关闭并重新打开 CLI / 桌面端）

### 从本地导入（"我换机器了 / 想把现有配置存档"）

1. 点 **从本地导入** → 弹出教程模态（**两阶段**）
2. 第一阶段先看说明：哪里找本机文件、m2c key 配置注意事项
3. 点 **我已了解，开始填写** 切到表单
4. 把本机 `~/.codex/auth.json` 和 `config.toml` 的内容粘贴进来，可选填 provider / model / 备注
5. 提交后：
   - **本地模式**：直接写入 `~/.codex/`（原文件会被备份为 `*.bak.<时间戳>`）
   - **Server 模式**：仅记入 `codex_config_history` 表，不写任何本地文件
6. 任何时候都能去「History」tab 点 **Bundle** 把这一条重新拉下来回撤

### History（时间线 + 任意点恢复）

`/admin/codex` 底部 **History** tab 列出该用户的配置时间线：

- 每用户保留最早一条 `initial`（首次 apply 前 ~/.codex 的快照）+ 最近 10 条 apply / restore / import
- `initial` 永远不删，便于一键回到 mimo2codex 之前的原始 Codex 配置——点该条的 **Bundle** 下载即可"卸载"mimo2codex
- 每条都有 **Bundle** 按钮，下载流程同上（包括 server 模式下的 placeholder + 手填 m2c key 步骤）

### "运行时覆盖"（不写文件的快速切换）

如果只想临时换上游模型而不改 Codex 配置：

- `/admin/codex` → 「思考与运行时覆盖」tab → 选目标 provider + model
- 后续 mimo2codex 收到请求时优先用这个覆盖，**Codex 完全无感**
- 重启清掉或在页面上点清除

## OAuth：Gitee / GitHub 三方登录

### 1. 在 OAuth 平台注册应用

**GitHub**：<https://github.com/settings/applications/new>
- Homepage URL：`https://your-domain/`
- Authorization callback URL：`https://your-domain/oauth/callback/github`

**Gitee**：<https://gitee.com/oauth/applications/new>
- 应用回调地址：`https://your-domain/oauth/callback/gitee`
- 权限范围：勾选 `user_info`

> ⚠️ Gitee 强制要求 HTTPS callback。GitHub 测试环境也接受 http，但生产请上 HTTPS。Docker 部署建议挂 nginx / caddy 反代加 TLS。

### 2. 在 admin 里填配置

用管理员账号登录，到 `/admin/account` → **OAuth providers (admin)**：

- Client ID / Client secret / Callback URL 三项必填
- 切 **Enabled** → Save
- 配 secret 时密文经 master key 加密入 `oauth_clients` 表；以后修改不必再填 secret（留空 = 保留原密文）

### 3. 用户登录

退出登录回到 `/admin/login`，下面会多出 **Continue with GitHub** / **用 Gitee 登录** 按钮（仅显示已启用的）。

流程：

1. 点按钮 → 302 跳到 OAuth provider → 用户授权
2. provider 跳回 `/oauth/callback/<provider>?code=...&state=...`
3. mimo2codex 校验 state（10 分钟过期、单次使用）、用 code 换 access_token、拉 user info
4. 没绑定过本地账号 → 自动建一个（用户名形如 `github_octo`，密码字段空）
5. 已绑定 → 直接复用本地账号
6. 发 session cookie，302 到 `/admin/`

> 同一 GitHub / Gitee 账号再次登录始终复用同一个本地账号（按 provider + provider_user_id 唯一索引）。

## 主密钥 (Master Key)

主密钥用来加密：

- 用户的 BYOK 上游 key
- OAuth client_secret

**优先级**：

1. 环境变量 `MIMO2CODEX_MASTER_KEY`（32 字节 base64）—— **生产推荐**，主密钥不和密文同机存放
2. `<dataDir>/master.key`（32 字节 hex，权限 `0o600`）—— 首次启动若 env 未设会**自动生成**，控制台打 warn

生成一个：

```bash
# bash / zsh
openssl rand -base64 32

# PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# 或者用 node 一行
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

填到 `docker-compose.yml`：

```yaml
services:
  mimo2codex:
    environment:
      - MIMO2CODEX_MASTER_KEY=<上面生成的 base64 字符串>
```

> ⚠️ 一旦丢了主密钥（env 没存档 + master.key 文件没了），所有 BYOK / OAuth secret 密文都解不开了。文件方式的话也别把 `master.key` 一起 git 上去——它已经在 `.gitignore`（参考 `~/.mimo2codex/` 整目录都该 ignore）。

## 运维提示

- **Cookie Secure**：HTTPS 部署时设 `MIMO2CODEX_COOKIE_SECURE=1`，session cookie 加 `Secure` 属性。HTTP 调试时不要开（浏览器会拒收）。
- **Bind host**：Docker 镜像默认 `MIMO2CODEX_HOST=0.0.0.0`；CLI 默认 `127.0.0.1`。你想直接把 CLI 暴露到 LAN，加 `--host 0.0.0.0` 并务必开 `--auth on`。
- **第一管理员重置**：忘了 admin 密码？管理员另一个账号在 `/admin/users` 改密码即可；如果只有一个 admin 且密码丢失，最简单是停服 → 用 sqlite 命令把 users 表清空再重启（会触发首次注册流程，下次访问 `/admin/` 就是新建第一个 admin 的表单）：
  ```bash
  sqlite3 ~/.mimo2codex/data.db "DELETE FROM users;"
  ```
- **会话过期清理**：每次访问会自动跳过期 session；可以加 cron 调用 `pruneExpiredSessions()` 也行，但量小（≤20 人）通常不必。

## 故障排查

**"我开了 `MIMO2CODEX_AUTH=on` 但页面还是直接进 admin / 没有登录页"**

99% 是 env 没被读到。按下面三步排查：

1. 看启动日志有没有 `INFO auth: on` 这行（users 表为空时还会再多一段 **First-run admin setup needed** 横幅）。**没有 → env 没生效**。
2. 确认你写到了正确的位置：
   - ✅ shell 当前会话：`$env:MIMO2CODEX_AUTH = "on"`（PowerShell）或 `export MIMO2CODEX_AUTH=on`（bash）
   - ✅ `~/.mimo2codex/.env` 里加 `MIMO2CODEX_AUTH=on`
   - ❌ 项目根目录的 `.env` —— **不会被加载**
3. 直接传 CLI flag：`npm run dev -- --auth on`，最稳。

**"我登录了，但 Codex 还是 401"**

Server 模式下 `/v1/*` 必须带 bearer token。检查：

- `~/.codex/auth.json` 里的 `OPENAI_API_KEY` 是不是你在 `/admin/account` 创建的 `m2c_...` token？
- 这个 token 没有被你后来 revoke 吗？（`/admin/account` 看是否还在 active）

**"OAuth 回调 400 invalid or expired OAuth state"**

state token 10 分钟有效。如果你点了"用 GitHub 登录"按钮、然后离开喝了杯咖啡再回来授权，就会过期。重新走一遍流程即可。

**"BYOK 设置后请求还是用共享 key"**

按这个顺序排查：

1. 上游日志看看实际带的 key 前缀，确认到底是哪条 key
2. `chat_logs` 里的 `apiKeySource` 日志（v0.2.16+ debug 等级会打）
3. 主密钥换过吗？换过的话旧密文解不开，会静默回退到共享 key。重新填一次 BYOK 即可
