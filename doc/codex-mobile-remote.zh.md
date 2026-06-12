# 用手机操作 Codex（保留 ChatGPT 登录 + 走代理）

<p>
  <a href="./codex-mobile-remote.md">English</a> ·
  <a href="./codex-mobile-remote.zh.md"><strong>简体中文</strong></a>
</p>

本文说明：如何在保持真实 **「Sign in with ChatGPT」** 登录的同时，让模型仍走 mimo2codex 代理 ——
这样你就能用 OpenAI 官方的 **Codex 手机端 / 远程** 功能（用手机操作这台电脑上的 Codex），而背后的
模型是 MiMo / DeepSeek / 通用模型。

## 它是什么 —— 以及它不是什么

- **mimo2codex 不实现远程中继。** 「用手机操作 Codex」的中继是 OpenAI 自家的基础设施（手机 ChatGPT
  App 和这台电脑上 Codex 桌面端之间的安全中继），mimo2codex 改不了。
- **mimo2codex 在这里只做一件小事：** 保住你的 ChatGPT 登录（让官方功能继续可用），同时只把*模型后端*
  重定向到本地代理。

## 为什么需要「保留登录」模式

此前启用 mimo2codex provider 会把 `~/.codex/auth.json` **覆盖**成占位 key，把你从「Sign in with
ChatGPT」登出，于是官方登录和代理互斥。**保留登录**的启用方式会对 `auth.json` **一字节都不改**，只
改写 `config.toml`。

## 步骤

1. **在 Codex 里登录 ChatGPT。** 在这台电脑上执行 `codex login`（Sign in with ChatGPT），或确认你已
   经登录。
2. **用「保留登录」启用一个模型。** 打开管理后台的 **Codex 启用** 页（`/admin/codex`），启用某个
   provider/模型。检测到真实登录时，mimo2codex **默认保留它**、只重定向模型。（确认弹窗会说明这点；
   仍可勾选退回旧的覆盖行为。）
3. **在桌面端设置 Codex 手机端。** 在 Codex 桌面端打开 **「Set up Codex mobile」**，用手机 ChatGPT
   App 扫码 —— 两边必须是**同一个 OpenAI 账号**。
4. **在手机上派发任务。** 在手机上发起、批准任务；代码、文件、shell 都在*这台*电脑上执行，而背后的
   模型已经是你的 mimo2codex 上游。

## 底层原理

保留登录模式写出的 `config.toml` 和正常流程一样：

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

`requires_openai_auth = true` 是告诉 Codex 把你的凭证作为 bearer 附到**这个 provider 的 `base_url`** ——
也就是本地代理，而不是 OpenAI。因为 `auth.json` 里仍是你真实的 ChatGPT OAuth token，Codex 会把这个
token 发给 mimo2codex，而 mimo2codex **忽略入站凭证**、把请求转发到你真实的上游（MiMo / DeepSeek /
…）。你的 ChatGPT 登录从未被动过，官方手机端/远程中继所依赖的账号状态保持有效。

> 本地默认 `MIMO2CODEX_AUTH=off`，`/v1/*` 不校验入站 bearer —— 真实的 ChatGPT token 直接透传后被丢弃。
> （在 `auth=on` 部署里 `/v1/*` 需要 `m2c_` bearer，那是另一种 server 模式部署。）

## ⚠️ 注意 —— 远程这个组合是尽力而为

官方**远程**模式到底会不会把模型走你本地的代理（还是在服务端强制用 OpenAI 自家模型），**没有官方文档**
说明。这台电脑上的本地 Codex 用的是你的 `config.toml`、确实会走代理；不确定的纯粹是手机驱动的远程
路径。

**请自行验证：** 用手机派发一个任务后，看 mimo2codex 日志（或管理后台 **Logs** 页），确认请求确实打到
了代理。如果没有，说明远程路径不管你本地配置、用的是 OpenAI 自家后端 —— 这是 OpenAI 侧的限制，不是
mimo2codex 的 bug。

## 相关

- 手动配置片段（含**「保留 ChatGPT 登录」**这个仅 config.toml 的变体）在管理后台 **Codex 启用** 页的
  先决条件折叠区里。
- 覆盖式流程与备份，见 [codex-enable.zh.md](./codex-enable.zh.md)。
