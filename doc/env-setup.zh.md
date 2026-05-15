# .env 与一键加载脚本 · 分系统快速配置

> [English](./env-setup.md) · 中文
>
> 返回：[README 中文](../README.zh.md) · [README English](../README.md)

mimo2codex 把每个 provider 的 API key 都做成了**环境变量**——好处是不入库、不在配置文件里裸奔；坏处是每开一个新终端窗口都得重新 `export` 一遍。本仓库提供 `.env.example` + 一对加载脚本（`scripts/load-env.sh` / `scripts/load-env.ps1`），让你**一次填好所有 key，开窗口就一行命令注入**。

## 它解决什么

- 不想每次开 shell 都重新 `export MIMO_API_KEY=... && export DS_API_KEY=...`
- 想把 MiMo / DeepSeek / Qwen / Kimi / OpenAI 等多家 key 放一个文件里集中管
- 不想 key 写进 `~/.zshrc` / PowerShell `$PROFILE` 里全局污染（也不想被备份工具同步到云端）
- 不想 key 被 `git commit` 误带上去（`.env` 已经在 `.gitignore` 里）

## 30 秒上手

1. **复制模板**：项目根目录把 [.env.example](../.env.example) 复制成 `.env`
2. **填 key**：打开 `.env`，把你用到的那几行前面的 `#` 去掉，把 `sk-xxxxx` 换成真 key
3. **注入 shell**：用下面对应你系统的脚本
4. **跑起来**：`mimo2codex`

```text
.env.example  ← 模板，进仓库
.env          ← 你的真 key，.gitignore 已挡
scripts/
  load-env.sh   ← bash / zsh / Git Bash / WSL 用
  load-env.ps1  ← Windows PowerShell 用
```

## 分系统操作

### macOS / Linux（bash / zsh）

```bash
cp .env.example .env
# 用你喜欢的编辑器把 .env 改完，比如：
#   MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx

source scripts/load-env.sh
# load-env: 1 variable(s) loaded from .env
#   - MIMO_API_KEY

echo $MIMO_API_KEY   # 验证：应该打印你的 key
mimo2codex
```

> ⚠️ 必须用 `source`（或等价的 `.`），**不能**直接 `bash scripts/load-env.sh` —— 直接执行会开子 shell，env 设完就丢，回到你这边什么都没有。脚本里已经做了检测，错误执行会立刻报错退出。

### Windows PowerShell

```powershell
Copy-Item .env.example .env
# notepad .env  ← 或用任意编辑器填 key

. .\scripts\load-env.ps1
# load-env: 1 variable(s) loaded from .env
#   - MIMO_API_KEY

echo $env:MIMO_API_KEY    # 验证
mimo2codex
```

> ⚠️ **建议加上前面那个点 `.`**——这是 PowerShell 的「dot-source」语法。本仓库的 `load-env.ps1` 用 `Set-Item Env:` 设值（操作的是进程级环境变量），所以即使少了点也碰巧能用；但绝大多数同类 PowerShell 配置加载脚本都用 `$var = ...`，少了 dot-source 就会丢——养成 dot-source 的习惯能避免日后踩别的脚本的坑。

**如果遇到「无法加载脚本，因为在此系统上禁止运行脚本」**：

```powershell
# 临时绕过（只对当前 PowerShell 窗口有效，关掉就恢复）
Set-ExecutionPolicy -Scope Process Bypass
. .\scripts\load-env.ps1

# 或者：单独给这个脚本解锁
Unblock-File .\scripts\load-env.ps1
. .\scripts\load-env.ps1
```

如果你想永久允许（仅对当前用户，不影响系统）：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Windows Git Bash / WSL / Cygwin

和 macOS / Linux 一样走 `.sh` 脚本：

```bash
cp .env.example .env
source scripts/load-env.sh
mimo2codex
```

### Windows cmd.exe（不推荐）

加载脚本不支持 cmd。要么切到 PowerShell（按 `Win+X` → Windows PowerShell），要么手动 `set`：

```cmd
set MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
mimo2codex
```

`set` 只在当前 cmd 窗口有效。要持久化（任何新进程都能读到）用 `setx KEY VALUE`，但 `setx` 不会影响当前窗口，得开新窗口才生效。

## `.env` 语法

脚本和 dotenv 系列工具基本一致，规则简单：

| 写法 | 行为 |
|---|---|
| `KEY=value` | 标准赋值 |
| `KEY="value"` / `KEY='value'` | 两端的引号会被剥掉，内部按字面量处理（**不**做 `$var` 展开、**不**做 `\n` 转义） |
| `# comment` 整行 | 跳过 |
| 空行 | 跳过 |
| `export KEY=value` | 兼容写法，等同于 `KEY=value` |
| 已经存在的同名 env | **覆盖**（`.env` 是 source of truth） |
| Windows CRLF 行尾 | bash 版会自动剥 `\r`，PowerShell 版由 `Get-Content` 处理 |
| 非法 key 名（含数字开头、特殊字符） | 跳过 + 打 warning |

完整带注释的可用 key 列表见 [.env.example](../.env.example)，主要包含：

- 内置 provider：`MIMO_API_KEY`、`DS_API_KEY` / `DEEPSEEK_API_KEY`
- 通用 provider 单实例：`GENERIC_BASE_URL` / `GENERIC_API_KEY` / `GENERIC_DEFAULT_MODEL`
- 通用 provider 多实例（看你的 `providers.json` 里 `envKey` 字段写了啥）：`QWEN_API_KEY` / `KIMI_API_KEY` / `GLM_API_KEY` / `OPENAI_API_KEY` …
- 运行时配置：`MIMO2CODEX_HOST` / `MIMO2CODEX_PORT` / `MIMO2CODEX_DATA_DIR` / `MIMO2CODEX_DEFAULT_PROVIDER` / `MIMO2CODEX_NO_REASONING` / `MIMO2CODEX_VERBOSE` / `MIMO2CODEX_NO_ADMIN` / `MIMO2CODEX_CONTEXT_OVERFLOW_MODE`

## 常见问题

<details>
<summary><b>每次开新终端窗口都得重新 source？</b></summary>

是的——env 是 per-shell 的，一旦窗口关掉就没了。这是设计如此，避免 key 永驻系统。如果你确实想全局可用，挑一种持久化方式：

- **macOS / Linux**：把 `source /path/to/mimo2codex/scripts/load-env.sh` 加到 `~/.zshrc` 或 `~/.bashrc` 末尾
- **PowerShell**：编辑 `$PROFILE`（`code $PROFILE` 或 `notepad $PROFILE`），加一行 `. C:\path\to\mimo2codex\scripts\load-env.ps1`

但这样做的代价是**所有**子进程都会读到你的 key —— 谨慎一点的做法是只在 mimo2codex 项目目录里 source，需要时再做。
</details>

<details>
<summary><b>Codex 桌面端读不到我 source 的 env 怎么办？</b></summary>

桌面应用从 GUI（Dock、开始菜单）启动时**不继承 shell 环境变量**。mimo2codex 的默认输出本来就避开了这个坑——`mimo2codex print-config` 给的是 `auth.json` 方式（Codex 通过 `requires_openai_auth = true` 读 `~/.codex/auth.json`），完全不依赖 shell env。详见主 README 的 [Configure Codex](../README.zh.md#3-配置-codex) 章节。

如果你坚持用老的 `env_key` 方式，则桌面端必须从命令行启动（macOS：`open -a Codex`，Windows：`Start-Process codex`），那样会继承当前 shell 的 env。
</details>

<details>
<summary><b>能不能不暴露 key？只看脚本加载了哪些？</b></summary>

脚本设计就是**只打印 key 名，从来不打印 key 值**。`source scripts/load-env.sh` 输出形如：

```
load-env: 3 variable(s) loaded from .env
  - MIMO_API_KEY
  - DS_API_KEY
  - QWEN_API_KEY
```

值想看自己 `echo $MIMO_API_KEY`，但这意味着 key 会进 shell history —— 想避开就用 `printenv MIMO_API_KEY | head -c 10`（只看前 10 个字符）。
</details>

<details>
<summary><b>加载多个 .env 文件（dev / prod）？</b></summary>

脚本第一个参数就是文件路径：

```bash
source scripts/load-env.sh .env.dev      # bash
. .\scripts\load-env.ps1 .\.env.prod     # PowerShell
```

后加载的会**覆盖**先加载的同名 key——`.env` 自身就是这么处理的。
</details>

<details>
<summary><b>不小心把 .env 提交了怎么办？</b></summary>

`.gitignore` 已经挡了，但万一改名或被 `git add -f` 强制加进去：

```bash
git rm --cached .env       # 从索引里去掉，但保留本地文件
git commit -m "untrack .env"
```

如果已经 push 到远端，**立刻把所有泄露的 key 在各家控制台 revoke 重发**——历史里的内容用 `git filter-repo` / `bfg` 也能清，但已经 push 出去的就当泄露了。
</details>
