# Community Feedback

This file collects substantive product feedback submitted by community contributors. We keep it in-tree (rather than only living as GitHub PR / issue comments) so feedback that drove real changes stays discoverable in the codebase itself.

When you incorporate a piece of feedback into a release, link the matching entry from `doc/tag-log.md` and credit the contributor.

---

## 2026-05-27 — Desktop UX suggestions (contributor: @starlsd93-sudo)

Originally submitted as part of [PR #43](https://github.com/7as0nch/mimo2codex/pull/43) (`功能优化建议.md` + icon designs). The icon files landed under [`package/brand/contributed-by-starlsd93/`](../package/brand/contributed-by-starlsd93/); the suggestion content is preserved verbatim below.

### Disposition (as of v0.5.6)

| Item                                                  | Status                              |
| ----------------------------------------------------- | ----------------------------------- |
| A1: First-run / settings UI supports multiple provider keys at once + custom base URL | ✅ landed in v0.5.6 |
| A2: Open desktop Settings from inside the Admin UI    | ✅ landed in v0.5.6 (signal endpoint + Electron watcher + Admin UI button) |
| A3: One-click import from `~/.mimo2codex/.env`        | ✅ landed in v0.5.6 |
| B:  Icon redesign (Windows `icon.ico`)                | ✅ landed in v0.5.6 (orange variant) |

### Original text (中文，作者署名 @starlsd93-sudo)

> 我从事机械工程 / 机器人方向，并不擅长程序开发。因此在这里加一个 Hope 文档，提出对新功能的一些小建议，希望有价值！

#### A 桌面端 env 配置

早期采用 npm 安装后，在用户文件夹的 `.mimo2codex` 文件夹中有 `.env` 进行配置。建议：

**1. 桌面端安装过程提示**

新安装的桌面端在安装过程中提示输入 mimo / deepseek 的 api key。不过不能同时输入，并且没有设置小米 tp 订阅的 api 链接选项。

我是 mimo 和 deepseek 养蛊，因此我需要从原先 `.env` 中提取 key 和 url 配置代码，然后在桌面端安装好后的 `AppData\Roaming\mimo2codex-desktop` 中的 `.env` 键入。

**2. 运行过程进行配置**

安装好后在 systemtray 中右键 settings，可以调出安装过程中的订阅设置选项（这里面设置项也不全）。在控制台界面设置项希望增加 settings 的入口。

**3. 旧配置导入**

如果有功夫的话，在设置项里面加一个 "一键导入" 的选项，应该会更好。

#### B 软件图标

现在软件图标分辨率太低啦（笑）。
我尝试用 AI 融合了这两者，建了一个 `icons` 目录，好用的话就加上 ^_^

---

*想反馈？* 用 GitHub Issue / Discussion / PR 都可以。被采纳的建议会在新版本的 release note 里点名感谢，并在本文件留档。
