# mimo2codex 桌面端设计文档

**日期**：2026-05-22
**作者**：chengj
**状态**：approved, ready for implementation planning

## Context

mimo2codex 当前形态是 Node.js CLI：`npm install -g mimo2codex` → 终端启动 → 浏览器打开 `localhost:8788/admin/` 管理。这对终端熟练用户没问题，但社区反馈显示**跨专业用户**（产品、设计、运营，甚至非技术背景的爱好者）卡在两点上：

1. **依赖终端**：要保持一个控制台窗口常开，关掉就退出，"挂后台"对他们是黑话
2. **依赖浏览器**：每次想看 / 改 admin 设置都要重新打开浏览器、敲地址

诉求很统一：**像 Clash 那样有个托盘 / 顶栏图标，点开就能用**。

目标：在 mimo2codex 上**叠加**一个桌面端壳子（Windows 系统托盘 + macOS 顶栏菜单），后台跑 mimo2codex 服务，提供轻量配置 + admin UI 入口 + 自启动 + 优雅退出。

**硬约束**：
- 不动现有 CLI 源码、CLI 打包（`npm install -g mimo2codex` 流程零变化）
- 不动现有 Docker / GHCR 工作流
- 桌面端构建是**独立流水线**，与 npm/Docker 发布完全解耦
- 桌面端是**独立功能**，命令行用户不会被强迫装

---

## 1. 项目布局

桌面端代码全部归到新增的 `package/` 子目录，根 `package.json` **仅在 `scripts` 区**加几个转发别名，**不引依赖**。

```
mimo2codex/
├── src/                            ← 现有 CLI（一行不动）
├── web/                            ← 现有 admin UI（一行不动）
├── dist/                           ← 现有 CLI 产物
├── docweb/                         ← mimodoc.chengj.online 源码
│   └── src/pages/Download.tsx      ← 新增：下载页（§7）
│
├── package/                        ← 新增工作区
│   ├── desktop/                    ← Electron 主源码（跨平台共享）
│   │   ├── src/
│   │   │   ├── main.ts             ← Electron main process 入口
│   │   │   ├── tray.ts             ← 托盘 / 顶栏菜单
│   │   │   ├── sidecar.ts          ← 派生 + 监管 mimo2codex CLI
│   │   │   ├── autostart.ts        ← app.setLoginItemSettings 封装
│   │   │   ├── ipc.ts              ← renderer ↔ main 通道
│   │   │   ├── runtime.ts          ← 读写 userData/runtime.json
│   │   │   └── windows/
│   │   │       ├── settings.ts     ← 首次启动 + 设置窗
│   │   │       ├── adminWebview.ts ← 嵌入 admin UI 的 BrowserWindow
│   │   │       └── logs.ts         ← tail -f 日志窗
│   │   ├── renderer/               ← 设置窗 React（AntD 保持视觉一致）
│   │   │   ├── settings/App.tsx
│   │   │   └── logs/App.tsx
│   │   ├── shared/                 ← 主 / 渲染进程共用的类型 + 常量
│   │   ├── package.json            ← 独立 deps：electron / electron-builder
│   │   ├── tsconfig.json
│   │   └── electron-builder.yml
│   ├── win/
│   │   ├── icon.ico                ← 由 §6 logo 派生（多尺寸）
│   │   └── tray.ico                ← 16/32 双尺寸彩色
│   ├── mac/
│   │   ├── icon.icns               ← 由 §6 logo 派生
│   │   ├── tray-Template.png       ← 16/32 黑白模板，自适应深浅 mode
│   │   └── entitlements.mac.plist  ← com.apple.security 最小集
│   └── brand/                      ← logo 源文件（SVG + 1024 PNG），§6
│       ├── logo.svg
│       └── logo-1024.png
│
└── .github/workflows/
    └── build-desktop.yml           ← 新增独立 workflow
```

**根 `package.json` 改动（仅 scripts，依赖区不动）**：
```jsonc
{
  "scripts": {
    "desktop:dev":   "npm --prefix package/desktop run dev",
    "desktop:build": "npm --prefix package/desktop run build",
    "desktop:pack":  "npm --prefix package/desktop run pack"
  }
}
```

---

## 2. 运行时架构（sidecar 模式）

```
Electron Main Process (Node 20, bundled by Electron)
  ├─ App lifecycle (start/quit/autostart)
  ├─ Tray icon + menu
  ├─ Settings window (1st run + Settings... menu)
  ├─ Admin UI window (BrowserWindow → http://127.0.0.1:<port>/admin/)
  ├─ Logs window (tail of sidecar stdout/stderr)
  └─ Sidecar Manager
        │ child_process.spawn()
        ▼
     mimo2codex-sidecar(.exe)   ← 用 @yao-pkg/pkg 把现有 dist/cli.js 编译成单二进制
        ├─ HTTP :8788 (or auto-bumped)
        ├─ admin webui
        └─ sqlite / .env / providers.json （从 OS userData 目录读）
```

**关键决策**：
- **sidecar 单文件路线**（vs 主进程内嵌 `require('dist/cli.js')`）：
  - 失败时主进程不死，能弹气泡 + 留日志
  - 现有 CLI 不需要任何"是不是被 Electron 起的"分支判断
  - better-sqlite3 native `.node` 跟 sidecar 一起被 pkg 拍扁
- **数据目录**：默认 OS userData（`%APPDATA%\mimo2codex` / `~/Library/Application Support/mimo2codex`），与命令行版的 `~/.mimo2codex/` 物理隔离 —— 同机用户装两份不会互相污染
- **端口选择**：默认 8788，被占自动 +1 探测到空闲端口，写进 `userData/runtime.json`，设置窗能改
- **崩溃自愈**：sidecar 退出码 ≠ 0 时主进程自动重启 1 次；第二次失败 → 托盘气泡 "mimo2codex sidecar 启动失败，点击查看日志" + 留在崩溃态等用户操作（不再无限重试）
- **退出**：托盘 Quit / `app.quit()` 时给 sidecar 发 SIGTERM，2 秒不退 → SIGKILL
- **日志**：sidecar stdout/stderr → `userData/logs/sidecar-YYYYMMDD.log`，按天滚，保留最近 7 天

---

## 3. 托盘菜单 + 窗口

### 3.1 菜单结构（Win / Mac 完全一致）

```
┌──────────────────────────────────────┐
│ ●  mimo2codex · running on :8788    │ ← 状态 header（不可点）
├──────────────────────────────────────┤
│   Open Admin UI in browser           │ → shell.openExternal('http://127.0.0.1:<port>/admin/')
│   Open Admin UI in app...            │ → 内嵌 BrowserWindow（700×900，可选记忆位置）
├──────────────────────────────────────┤
│   Settings...                        │ → 设置窗（§3.3）
│   Show logs...                       │ → 日志窗（§3.4）
├──────────────────────────────────────┤
│ ☑ Start on system boot               │ → 切换 autostart（§3.5）
├──────────────────────────────────────┤
│   Restart sidecar                    │
│   About                              │ → 关于对话框（版本号 + GitHub 链接 + 检查更新链接）
│   Quit                               │
└──────────────────────────────────────┘
```

**状态 header 文案**：
- 正常：`● mimo2codex · running on :8788`（绿点）
- 启动中：`○ mimo2codex · starting...`（黄点）
- 崩溃：`✕ mimo2codex · sidecar crashed`（红点，click → 日志窗）

### 3.2 平台特化

**Mac**：
- 顶栏图标用 **template image** 命名约定（`tray-Template.png`，黑白），系统自动跟随深 / 浅 mode 反色
- `app.dock.hide()` 全程隐藏 Dock 图标 —— **纯顶栏模式**（像 Clash X / 1Password 7）
- 顶栏图标小圆点叠加：绿 / 黄 / 红 三态实时绘制（用 `nativeImage.createFromBuffer` 合成）

**Windows**：
- 托盘图标用彩色 `.ico` 16/32/48 多尺寸；状态色用 3 套 `.ico` 切换（绿 / 黄 / 红版本）
- 不开任何主窗口 —— 设置窗 / Admin UI 窗 / 日志窗都是按需 hide 而非 quit
- 左键和右键都展开同一份菜单（Win 系统托盘约定）

### 3.3 设置窗（首次启动自动弹 + Settings... 菜单调起）

字段最少化，4 个核心配置 + 1 个跳转：

```
┌─ mimo2codex Settings ──────────────────┐
│                                        │
│ Provider:  [MiMo            ▼]         │  ← 下拉：MiMo / DeepSeek / Generic
│ API Key:   [sk-xxxxxxxx           ]    │  ← password 输入框，左侧"显示"切换
│ Port:      [8788    ]                  │
│ Data dir:  [%APPDATA%\mimo2codex   ]  Choose... │
│                                        │
│ ☐  Start on system boot                │
│ ☑  Show admin UI on first launch       │
│                                        │
│ Advanced settings → opens Admin UI     │  ← 链接
│                                        │
│          [ Save & Restart ]  [ Cancel ]│
└────────────────────────────────────────┘
```

**行为**：
- **首次启动检测**：以下任一条件 → 设置窗自动弹出，sidecar **不启动**等用户填完 key
  - `userData/.env` 不存在
  - `.env` 存在但选定 provider 的 key 字段（如 `MIMO_API_KEY`）为空或仍是模板占位 `sk-xxxxxxxxxxxxxxxxxxxx`
- "Save & Restart" → 写入 `userData/.env` + `userData/runtime.json`（port / autostart 等），重启 sidecar
- 验证：API Key 留空时禁用 Save 按钮
- **Cancel**：首次启动场景下 Cancel 等于 Quit（避免没 key 还跑进无 sidecar 死状态）；非首次场景下 Cancel 只关窗
- "Show admin UI on first launch" 复选框语义："**这次** Save & Restart 完后，自动打开内嵌 Admin UI 窗口" —— 默认勾选；用户取消勾选 → 只起 sidecar、停在顶栏 / 托盘里。这是一次性意图，不持久化到 runtime.json

技术栈：和 admin UI 保持一致 —— React 18 + AntD 5（设置窗就 4 个字段，bundle 体积可控）。

### 3.4 日志窗

```
┌─ mimo2codex Logs ──────────────────────┐
│ [INFO] mimo2codex v0.4.5 listening...  │
│ [INFO] auth: off                       │
│ [WARN] upstream connect failed: ...    │
│ ...                                    │
│                                        │
│ [Clear] [Open log folder] [Auto-scroll]│
└────────────────────────────────────────┘
```

- 实时 tail `userData/logs/sidecar-*.log`，限 1000 行环形缓冲
- "Open log folder" → `shell.showItemInFolder(path)`，跨平台
- 用户报 issue 时直接打开 → 截图 → 贴 GitHub 一气呵成

### 3.5 自启动（autostart）

跨平台用 Electron 原生 API，**不引第三方依赖**：

```ts
app.setLoginItemSettings({
  openAtLogin: enabled,
  openAsHidden: true,            // Mac 启动时不弹窗，仅顶栏图标
  args: ["--autostart-launched"] // Win 用，识别开机自启场景
});
```

- Win 写注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Mac 写 LaunchAgent
- 开机自启时 `--autostart-launched` 让主进程跳过首次启动检查 + 不主动弹设置窗

---

## 4. GitHub Actions 打包矩阵 + 签名策略

### 4.1 触发

新增 `.github/workflows/build-desktop.yml`：
- `workflow_dispatch`（手动触发，默认）
- 推送 tag `v*-desktop`（如 `v0.4.5-desktop.0`）—— 与 npm 用的 `v*` tag **隔离**

### 4.2 矩阵

```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        arch: x64
        artifact: mimo2codex-desktop-${VERSION}-win-x64.exe
      - os: windows-latest
        arch: arm64
        artifact: mimo2codex-desktop-${VERSION}-win-arm64.exe
      - os: macos-latest         # Intel runner
        arch: x64
        artifact: mimo2codex-desktop-${VERSION}-mac-x64.dmg
      - os: macos-14             # Apple Silicon runner
        arch: arm64
        artifact: mimo2codex-desktop-${VERSION}-mac-arm64.dmg
```

### 4.3 单 job 步骤

1. checkout
2. 装 Node 20
3. 根目录 `npm ci`
4. `npm run build`（编现有 CLI 到 dist/）
5. `npx @yao-pkg/pkg dist/cli.js --target=node20-{plat}-{arch} --output package/desktop/resources/sidecar/mimo2codex-sidecar`（输出位置嵌入 Electron 资源目录）
6. 把 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 拷到 sidecar 同目录（pkg 不能自动嵌 native module）
7. `cd package/desktop && npm ci`
8. `npm run build`（编 Electron main + renderer）
9. `npx electron-builder --${plat} --${arch} --publish never`
10. 把产物 `.exe` / `.dmg` 重命名成 `artifact` 字段，上传 `actions/upload-artifact`

### 4.4 Release 发布

矩阵全跑完后**单独 job** 跑发布 step：
- 等所有 artifact 上传完
- `actions/download-artifact` 拉所有
- 对每个文件算 `sha256sum`，拼成一份固定格式的 release body：
  ```
  ## Desktop builds

  | Platform | Arch  | File                                          | SHA256 |
  |----------|-------|-----------------------------------------------|--------|
  | Windows  | x64   | mimo2codex-desktop-0.4.5-win-x64.exe          | abc... |
  | Windows  | arm64 | ...                                           | ...    |
  | macOS    | x64   | mimo2codex-desktop-0.4.5-mac-x64.dmg          | ...    |
  | macOS    | arm64 | ...                                           | ...    |
  ```
  这段 body 后续被 §7 下载页 grep 出来拿到 sha256
- `softprops/action-gh-release@v2` 创建 release，附 artifact

### 4.5 签名策略（v1：不签名）

| 平台 | v1 策略 | 用户看到 | 升级路径 |
|---|---|---|---|
| macOS | 不签，不公证 | Gatekeeper "无法打开" → 用户右键 → 打开（首次一次） | 申请 Apple Developer ID（$99/年）后开 `electron-builder` 的 `hardenedRuntime: true` + notarytool |
| Windows | 不签 | SmartScreen "已阻止" → 用户点"更多信息 → 仍要运行" | 拿到 EV / OV code-signing 证书后 signtool |

**理由**：签名证书要钱 + 流程负担，开源工具普遍走过这条路。下载页用红字明确告知 + 给 sha256 校验 + 截图绕过指引（§7）。后续有捐赠 / 收入再升级。

---

## 5. 不在 v1 范围内（YAGNI 清单）

- ❌ **自动更新**（electron-updater）—— v1 用户手动来下载页拉新版
- ❌ **代码签名**（§4.5）
- ❌ **auth=on 多用户模式**—— 桌面端 = 单用户场景，不混合
- ❌ **SOCKS5 代理 / 系统代理自动检测**—— 另一条独立 feature 线
- ❌ **设置窗 / 日志窗 i18n**—— 仅英文，字段量 4 个零负担，未来加
- ❌ **Microsoft Store / Mac App Store 上架**—— 走得通但复杂度爆表
- ❌ **数据迁移 wizard**（`~/.mimo2codex/` → OS userData）—— v1 让用户手动复制，admin UI 已有 §0.4.2 的迁移功能
- ❌ **logo 多场景套件**—— 只做 §6 选定方向的 SVG + 1024 PNG 两份源文件，其他尺寸由 electron-builder + sharp 自动派生

---

## 6. logo 设计（方向 A · 桥接 monogram）

### 6.1 视觉规范

- **形状**：64dp 半径的 squircle（Apple 风格圆角方形），内 padding 12%
- **底色**：对角 linear gradient
  - 起点（左上）：`#3B2F7A` 深紫
  - 终点（右下）：`#4F6CFB` 蓝
- **字母组**：`m2c` 居中，font-family `Inter` / `SF Pro Rounded` 700 字重，字色白 `#FFFFFF`，无 stroke
  - `m` 和 `c` 普通 lowercase 字形
  - **`2` 是设计核心**：在视觉中线下沉 8%，顶端做成向右下弯的小箭头 → 暗示"翻译方向"。可以看作是放倒的 `→` 嵌进 `2` 的形态。
- **光效**（仅在 1024px 大图）：右上角加一道 15% 不透明度的对角白光高光，模拟玻璃质感；favicon 尺寸不画
- **暗黑模式自适应**：不需要单独画 —— 紫蓝渐变在浅 / 深背景上都自带对比度

### 6.2 派生

- 源文件：`package/brand/logo.svg`（矢量，单文件，favicon 直接用）+ `package/brand/logo-1024.png`（光栅，1024×1024，做 ico/icns 输入源）
- `.ico` / `.icns` 由 `electron-builder` 在 CI 构建时从 `logo-1024.png` 自动派生
- Mac 顶栏 `tray-Template.png`：单独画一份**纯黑白**的简化版 —— 去渐变去光效，保留 `m2c` 字母组的剪影，输出 16/32px @1x/@2x 四个 PNG
- Win 托盘 `tray.ico`：直接用彩色版 16/32 双尺寸

---

## 7. docweb 下载页（mimodoc.chengj.online/download）

### 7.1 路由 + 文件

- `docweb/src/App.tsx` 新增路由 `/download` → 渲染 `docweb/src/pages/Download.tsx`
- 顶栏 `docweb/src/components/AppHeader.tsx` 在现有 "简介 / 功能 / 学习 / Codex" 之后插入 "下载" 链接

### 7.2 数据获取

浏览器直接打 GitHub REST API：

```
GET https://api.github.com/repos/7as0nch/mimo2codex/releases
```

筛选规则：`releases.find(r => r.tag_name.endsWith("-desktop"))` —— 用 `-desktop` 后缀 tag 把桌面 release 跟 npm release 区分开。

资产名匹配（正则）：
- Windows x64：`/desktop-.+-win-x64\.exe$/`
- Windows arm64：`/desktop-.+-win-arm64\.exe$/`
- macOS x64：`/desktop-.+-mac-x64\.dmg$/`
- macOS arm64：`/desktop-.+-mac-arm64\.dmg$/`

SHA256 从 release body 的表格里 grep（§4.4 固定格式）。

**缓存**：`sessionStorage` 缓存 release 数据 5 分钟，避免反复打 GitHub 60 req/h/IP 限制。
**降级**：fetch 失败 → 显示"前往 [GitHub Releases](https://github.com/7as0nch/mimo2codex/releases) 手动下载"。

### 7.3 页面结构（AntD 实现）

```
┌──────────────────────────────────────────────────────┐
│ AppHeader                                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│                ┌─────────────┐                       │
│                │             │                       │
│                │   LOGO 256  │  ← §6 方向 A 的 SVG
│                │             │                       │
│                └─────────────┘                       │
│                                                      │
│              mimo2codex 桌面端                        │
│         本地后台运行 · 托盘 / 顶栏菜单 · 一键启停        │
│                                                      │
│         ┌─────────────────────────────┐              │
│         │ 下载 Windows 版（x64）      │  ← 主 CTA：UA
│         └─────────────────────────────┘  自动选当前
│                                            平台 + 架构
│         其他平台 (Mac Intel / Apple Silicon / Win arm64) ▼
│                                                      │
│         v0.4.5 · 2026-05-22 · 32.4 MB                │
│         SHA256: a3c9f1...（点击复制）                  │
│                                                      │
├──────────────────────────────────────────────────────┤
│   为什么需要桌面端？                                    │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│   │ 🖥️       │  │ ⚙️       │  │ 🔄      │              │
│   │ 后台运行 │  │ 托盘菜单 │  │ 自启动  │              │
│   │ 不依赖   │  │ 一键开/关│  │ 开机即用 │              │
│   │ 终端窗口 │  │          │  │          │              │
│   └─────────┘  └─────────┘  └─────────┘              │
├──────────────────────────────────────────────────────┤
│ 首次打开会有系统安全警告，这是因为我们暂未购买代码签名证书 │
│ - macOS：右键应用 → 打开 → 确认                        │
│ - Windows：SmartScreen → 更多信息 → 仍要运行            │
│ 校验下载文件的 SHA256 与本页一致即可确认完整性。          │
├──────────────────────────────────────────────────────┤
│ 想用命令行版？  npm install -g mimo2codex →           │
└──────────────────────────────────────────────────────┘
```

### 7.4 交互细节

- **UA 自动选平台**：`navigator.platform` + `navigator.userAgent` 检测 Win / Mac，再用 `navigator.userAgentData?.architecture` 区分 arm64 / x64（Chromium 90+ 支持）；不支持的浏览器默认 x64
- **折叠面板**：AntD `<Collapse>`，展开后是 4 行表格（platform / arch / file size / sha256 / 下载按钮）
- **SHA256 点击复制**：`navigator.clipboard.writeText`，AntD message.success 反馈
- **加载状态**：fetch 期间显示 AntD `<Skeleton>` 占位，避免 CLS
- **双语**：复用现有 i18next 配置，所有文案双语 key 都放 `docweb/src/i18n/locales/{en,zh}.json`

### 7.5 footer 标语

```
mimo2codex 桌面端是开源工具，源码与构建脚本完全公开在
GitHub。本页直接从 GitHub Releases API 拉取最新版本，
不经任何中转。
```

---

## 8. 设计补遗（2026-05-22 第二轮审核）

第一轮通过后又对 Phase 2/5/6/7/8/9/10/11 做了一次逐项审核，补齐 12 个"漏一个就劝退非技术用户"级别的硬伤 + 6 个体验改进点。这些点都落到了 plan 的散落 Task 里（编号 .1 / .X 形式），不重写本 spec 主干。

### 8.1 必补（影响首次能否正常使用）

| 编号 | 漏点 | 影响 | Plan 落点 |
|---|---|---|---|
| A1 | 单实例锁 `app.requestSingleInstanceLock()` | 双开 → 端口冲突 → 启动失败 | Task 4.3.1 |
| A2 | macOS `LSUIElement=true` Info.plist | `app.dock?.hide()` 仅运行时；启动闪烁 + Cmd+Tab 列表残留 | Task 9.1.1 |
| A3 | macOS 通知权限请求 | 没授权时崩溃气泡静默丢失，用户看不到反馈 | Task 5.4 |
| A4 | macOS 应用 Edit 菜单 | 没有 application menu 时 Cmd+C/V 在 API Key 输入框不通 | Task 6.1.1 |
| A5 | BrowserWindow 的 Win taskbar 图标 | admin / 日志窗在任务栏显示默认 Electron 图标 | Task 8.1 + 8.2 修改 |
| A6 | better-sqlite3 win-arm64 prebuild 可用性 | npm prebuild 覆盖不稳；CI build 阶段才挂太晚 | Task 7.1.1（探针 + 降级 win-x64-only） |

### 8.2 必补（影响信任 / 体验观感）

| 编号 | 漏点 | 影响 | Plan 落点 |
|---|---|---|---|
| B1 | 退出确认弹窗 | 误点 Quit → sidecar 死 → Codex 会话中断 | Task 5.3 修改 |
| B2 | 首次启动数据位置告知 | API Key 明文存 `userData/.env`；报 bug 时用户不知道附哪个目录 | Task 6.2.1 |
| B3 | sidecar 版本漂移提示 | 桌面端 freeze 的 npm 版本几个月后过期，用户无感 | Task 5.5（启动后异步打 GitHub release，差 ≥1 minor → 托盘红点 + 跳转下载页） |
| B4 | DMG 背景 + NSIS 安装向导图 | 默认无定制安装界面"业余" | Task 9.1.1（`dmg.background` + NSIS `installerIcon` / `uninstallerIcon`） |
| B5 | README 根目录 + GH Release Body 反链 | CLI 用户 / GH Releases 访客找不到桌面端入口 | Task 11.3 |
| B6 | What's New 模板提前定稿 | 留 TODO 到发布日临时写双语高亮文案会出错 | Task 11.2 修改（给完整双语对象） |

### 8.3 建议补（明确既定立场，避免后续返工）

| 编号 | 立场 | Plan 落点 |
|---|---|---|
| C1 | 用 OS userData 而非 `app.getAppPath()` 相对路径，天然免疫 macOS translocation | Plan 文档头一行说明 |
| C2 | Mac 拆 x64/arm64 而非 universal binary（universal 体积 +60%；下载页已分架构） | Task 9.2 注释 |
| C3 | 托盘 tooltip 动态化为 `mimo2codex · :{port} · {status}` | Task 5.2 修改 |
| C4 | 设置窗端口变更过渡 UX（"Restarting sidecar on new port..."，disable Save，sidecar ready 后关窗） | Task 7.2.1 |
| C5 | CLI 文档 → 桌面端反向链接 | Task 11.3 一并处理 |
| C6 | 卸载数据清理选项（NSIS 可选复选框 / DMG 走文档） | Task 11.3 一并处理 |

### 8.4 仍守 YAGNI（明确剔除）

- ❌ 设置窗 Test Connection 按钮（admin UI 有 provider 健康检查页，重复）
- ❌ 设置窗深色模式（一年开 2 次，跟随 AntD 默认）
- ❌ 崩溃上报（Sentry/Bugsnag — 隐私 + 依赖）
- ❌ 完整 i18n 设置窗 / 日志窗（仍守 §5 英文 only）
- ❌ 自动更新（B3 只是显示红点 + 跳转下载页，不下载）
- ❌ macOS 沙盒 / hardenedRuntime（需要签名证书才有意义）
- ❌ macOS 通用二进制（见 C2）
- ❌ deep link / `mimo2codex://` 协议（没场景）

---

## 验证计划

### 单元 / 集成测试

1. **`package/desktop/test/sidecar.test.ts`**：spawn / kill / 崩溃自愈逻辑（mock child_process）
2. **`package/desktop/test/autostart.test.ts`**：`setLoginItemSettings` 调用契约
3. **`package/desktop/test/runtime.test.ts`**：`runtime.json` 读写 + 端口探测

### 手工冒烟（必跑）

1. Win 11：解压 .exe 安装包 → 安装 → 首次启动设置窗弹出 → 填 key → save → 托盘绿点亮 → 浏览器访问 admin UI 通
2. Mac arm64：打开 .dmg → 拖到 Applications → 首次右键打开（绕 Gatekeeper）→ 顶栏图标出现 → 顶栏菜单各项功能逐一点过一遍
3. **回归保护**：在装了桌面端的机器上 `npm install -g mimo2codex` → CLI 启动 → 数据目录走 `~/.mimo2codex/`，与桌面端 userData **物理隔离**，两份配置互不污染
4. **autostart 真机测试**：勾选 → 重启系统 → 验证开机后顶栏 / 托盘自动出现且无弹窗
5. **崩溃自愈**：手动 kill sidecar 进程 → 主进程检测到 exit 非 0 → 自动重启 1 次 → 验证恢复
6. **退出干净**：托盘 Quit → 验证 sidecar 进程在 ps 中消失（无 orphan）

### CI 验证

- workflow_dispatch 跑一次，确认 4 个 artifact 都成功生成
- 下载 Win x64 artifact 在虚拟机里实际安装一次
- mimodoc `/download` 页面预览能正确拉 release 数据

---

## 文件创建 / 修改清单

### 新增

| 路径 | 用途 |
|---|---|
| `package/desktop/package.json` | Electron 独立工作区 |
| `package/desktop/tsconfig.json` | TS 配置 |
| `package/desktop/electron-builder.yml` | 打包配置 |
| `package/desktop/src/main.ts` | Electron main 入口 |
| `package/desktop/src/tray.ts` | 托盘 / 顶栏菜单 |
| `package/desktop/src/sidecar.ts` | 派生 + 监管 mimo2codex CLI |
| `package/desktop/src/autostart.ts` | 自启动封装 |
| `package/desktop/src/runtime.ts` | userData / runtime.json |
| `package/desktop/src/ipc.ts` | renderer ↔ main 通道 |
| `package/desktop/src/windows/settings.ts` | 设置窗 |
| `package/desktop/src/windows/adminWebview.ts` | admin UI 窗 |
| `package/desktop/src/windows/logs.ts` | 日志窗 |
| `package/desktop/renderer/settings/App.tsx` | 设置窗 React |
| `package/desktop/renderer/logs/App.tsx` | 日志窗 React |
| `package/desktop/test/*.test.ts` | 单元测试 |
| `package/brand/logo.svg` | logo 矢量源（§6） |
| `package/brand/logo-1024.png` | logo 光栅源（1024×1024） |
| `package/win/icon.ico` | Windows 应用图标 |
| `package/win/tray.ico` | Windows 托盘图标（彩色多尺寸） |
| `package/mac/icon.icns` | macOS 应用图标 |
| `package/mac/tray-Template.png` | macOS 顶栏模板图（黑白多尺寸） |
| `package/mac/entitlements.mac.plist` | Mac 权限声明 |
| `.github/workflows/build-desktop.yml` | 桌面端打包 workflow |
| `docweb/src/pages/Download.tsx` | 下载页（§7） |
| `docweb/src/i18n/locales/{en,zh}.json` | 下载页文案 key（追加） |

### 修改

| 路径 | 修改内容 |
|---|---|
| 根 `package.json` | scripts 加 `desktop:dev` / `desktop:build` / `desktop:pack`，依赖区不动 |
| `docweb/src/App.tsx` | 加 `/download` 路由 |
| `docweb/src/components/AppHeader.tsx` | 顶栏加"下载"链接 |
| `docweb/public/favicon.svg` | 替换为 §6 logo |
| `doc/tag-log.md` + `tag-log.zh.md` | 桌面端 GA 时加 `[new]` 条目 |
| `web/src/release-notes.tsx` | 桌面端 GA 时加 release highlight |

### 不动

- `src/**`：现有 CLI 源码全部
- `web/**`：现有 admin UI 全部
- `Dockerfile` + `docker-compose.yml`
- 现有 GH Actions workflow
- 现有 npm 发布流程
