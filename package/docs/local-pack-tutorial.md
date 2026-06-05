# 本地打包教程 — mimo2codex 桌面端

这份文档教你在自己机器上把桌面端打成 `.exe`（Win）/ `.dmg`（Mac）安装包，**不依赖** GitHub Actions。

适用场景：本地试装、验证流程，确认没问题再去 CI 出正式 release。

---

## 0. 一次性环境准备

确认安装：

```bash
node --version    # 应 >= 20.x
npm --version
```

Windows 用户还需要 `tar.exe`（系统自带，Win 10 1803+）。Mac 自带。

仓库根目录第一次拉下来时：

```bash
npm ci                                 # 安装根 deps
npm --prefix package/desktop install   # 安装桌面端 deps（首次会下载 Electron ~100MB）
```

### Windows 用户：**必做一步** — 打开开发者模式

electron-builder 在打包时会解压 `winCodeSign` 工具包，里面带几个 macOS 的 dylib **符号链接**。普通 Windows 账户没有创建符号链接的权限，解压会失败，重试 4 次后整个打包流程崩。

**一次性修复（推荐）**：

```
设置 → 系统 → 开发者选项 → 开发人员模式 → 打开
```

或英文版：`Settings → System → For developers → Developer Mode → On`。

设置一次永久生效，不用重启。**没开这个的话，`desktop:pack:local` 第 1 步就会提前报错**，告诉你怎么修。

> 不想开发者模式的备选方案：用管理员身份打开 PowerShell（右键 PowerShell → 以管理员身份运行）再跑打包命令。每次都要这么做，不方便。

---

## 1. 一条命令打包（推荐）

```bash
npm run desktop:pack:local
```

这个 wrapper 自动按顺序跑 6 步、显示每步耗时、最后列出产物路径。第一次跑全量约 5–8 分钟。

可选参数（用法 `npm run desktop:pack:local -- --skip-sidecar`）：

| 参数 | 用途 |
|---|---|
| `--skip-sidecar` | 不重打 sidecar bundle（CLI 没改时用，节省 3–5 分钟） |
| `--force-icons` | 强制重生成 tray icons（改了 logo 后用） |
| `--clean` | 打包前清空 `package/desktop/release/` |

成功输出示例（Windows）：

```
────────────────────────────────────────────────────────────────
  mimo2codex desktop · local pack · Windows x64
────────────────────────────────────────────────────────────────

[1/6] Checking dependencies
        root + package/desktop installed; better-sqlite3 prebuild present

[2/6] Brand icons (tray + .ico / template PNG)
        skipped (already present; use --force-icons to regenerate)

[3/6] Sidecar bundle (CLI + Node 20.18.0 for win32-x64)
        ... npm run sidecar:build output ...
        ✓ done in 184.3s

[4/6] Desktop build (main process tsc + renderer vite)
        ✓ done in 6.2s

[5/6] electron-builder → Windows x64
        ... electron-builder output ...
        ✓ done in 41.7s

────────────────────────────────────────────────────────────────
  Artifacts
────────────────────────────────────────────────────────────────
  → D:\...\package\desktop\release\mimo2codex-desktop-0.4.5-win-x64.exe  (132.8 MB)

Next:
  • Double-click the .exe → Windows SmartScreen "More info" → "Run anyway"
  • System tray (^) → m2c icon appears → first run shows Settings window
```

如果你想看分步逻辑、跨平台细节、单步排错，继续看下文。

---

## 2. 手工三步流程（教学版）

桌面端打包分三层：**先 brand 资源 → 再 sidecar bundle → 最后 electron-builder**。三步顺序必须对，但单独跑某一步只更新对应那部分。

### 第 1 步：生成品牌资源（logo / icon）

```bash
npm run brand:render   # 1024×1024 PNG（首次或改了 SVG 时跑）
npm run brand:icons    # 生成 tray.ico / icon.ico (Win) + tray-Template.png (Mac)
```

这两条用 `sharp-cli` 和 `png-to-ico`，会通过 `npx --yes` 临时拉包，第一次跑会慢一点（30 秒），后面用 npm 缓存。

**Mac 用户还需要手工生成 `icon.icns`**（`iconutil` 只在 macOS 上有）：

```bash
# 生成各尺寸 PNG
mkdir -p package/mac/icon.iconset
for size in 16 32 64 128 256 512 1024; do
  npx --yes sharp-cli@4 -i package/brand/logo-1024.png \
    -o package/mac/icon.iconset/icon_${size}x${size}.png resize $size $size
done
# 拼装 icns
iconutil -c icns -o package/mac/icon.icns package/mac/icon.iconset
rm -rf package/mac/icon.iconset
```

Windows 用户跳过这步——`electron-builder` 在 Win 平台不需要 `.icns`。

### 第 2 步：构建 sidecar bundle

```bash
npm run sidecar:build
```

这个脚本做的事情：

1. 跑 `npm run build` 编译 mimo2codex CLI（TS → `dist/`）
2. 把 `dist/`、`mimoskill/`、`package.json` 复制到 `package/desktop/resources/sidecar/`
3. 在那里跑 `npm install --omit=dev` 装生产依赖（含 better-sqlite3 native binary）
4. 从 nodejs.org 下载对应平台的 Node 20.18 二进制，提取出来放到 `resources/sidecar/node-runtime/`

输出 ~100MB 左右。完成后会看到 `[sidecar] done → ... (~120 MB)`。

**只在 CLI 源码改了 / Node 版本要换的时候才需要重跑**——纯改桌面端 UI 不用动这步。

如果你想换打包目标架构（比如在 x64 Mac 上为 arm64 Mac 打包），设环境变量：

```bash
SIDECAR_PLATFORM=darwin SIDECAR_ARCH=arm64 npm run sidecar:build
```

> **注意：** 跨架构打包 sidecar 时，`better-sqlite3` 的 prebuild 必须对目标架构存在。先用 `npm run probe-prebuild` 验证：
>
> ```bash
> TARGET_PLATFORM=darwin TARGET_ARCH=arm64 npm run probe-prebuild
> ```
>
> 如果输出 "No better-sqlite3 prebuild found" 就说明该架构 prebuild 缺失，跨架构打包会失败——只能在目标架构机器上原生打包。

### 第 3 步：electron-builder 打包

桌面端 React 渲染层先 build：

```bash
npm --prefix package/desktop run build
```

然后调 electron-builder。**只打当前平台**：

```bash
# Windows（在 Windows 上运行）
npm --prefix package/desktop run pack:win

# Mac（在 Mac 上运行）
npm --prefix package/desktop run pack:mac
```

或简单地用：

```bash
npm --prefix package/desktop run pack
```

—— electron-builder 默认会按当前平台 + 当前架构出包。

产物路径：

```
package/desktop/release/
├── mimo2codex-desktop-0.4.5-win-x64.exe    ← Win 安装器
└── mimo2codex-desktop-0.4.5-mac-arm64.dmg  ← Mac 安装镜像（如果在 Mac 上跑）
```

---

## 3. 验证安装包

### Windows

双击 `mimo2codex-desktop-0.4.5-win-x64.exe`：

- SmartScreen 警告："Windows 已保护你的电脑" → 点 **"更多信息" → "仍要运行"**（因为没有代码签名，预期行为）
- 安装路径让你选；勾选 "Create desktop shortcut"
- 完成后**任务托盘**右下角会有 m2c 图标
- 第一次启动会弹设置窗，填 API Key → Save & Restart
- 完成后右键托盘 → "Open Admin UI in browser" 测试

完整确认清单：

- [ ] 托盘菜单 9 个条目都能点（状态 header / browser / app / Settings / logs / boot 复选框 / Restart / About / Quit）
- [ ] Settings 窗 "Data location" 行显示 `%APPDATA%\mimo2codex-desktop`，点 Open 能打开文件夹
- [ ] Show logs 窗能看到 sidecar 实时输出
- [ ] Quit 确认弹窗 → 选 Quit → 任务管理器里 sidecar 进程消失
- [ ] 双开（再次双击桌面快捷方式）应该不会启第二个实例

### Mac

挂载 `.dmg` → 拖到 Applications → 第一次右键 → 打开 → 确认（绕过 Gatekeeper）：

- 顶栏右上角出现 m2c silhouette（template image 跟随深浅模式反色）
- **不在 Dock 显示，不在 Cmd+Tab 列表里**——这是 LSUIElement 的效果
- 设置窗能用 Cmd+C / Cmd+V 粘贴 API Key

### 卸载测试

- Windows：设置 → 应用 → mimo2codex → 卸载。默认保留 `%APPDATA%\mimo2codex-desktop`（要彻底清除手动删除）
- Mac：从 /Applications 拖到废纸篓。配置在 `~/Library/Application Support/mimo2codex-desktop/`，要彻底删手动 `rm -rf`

---

## 4. 常见问题

### Q: `sidecar:build` 报 "No free space" / 网络慢

Node 二进制 ~30MB（压缩后 ~20MB），下载用 https://nodejs.org/dist/。如果在国内：

```bash
# 设置 npm 国内源（仅限 sidecar 内 npm install 部分）
# Node 二进制下载需要直连 nodejs.org，国内可能需要代理
HTTPS_PROXY=http://127.0.0.1:7890 npm run sidecar:build
```

### Q: electron-builder 抱怨 "icon.icns not found"

只在 Mac 上需要。Win 跑 `pack:win` 不会读 Mac icon。

### Q: 打出来的安装包能跨平台用吗

不能。Win 上打出来的 `.exe` 只能装 Win，Mac 上打出来的 `.dmg` 只能装 Mac。CI 用 matrix 4 个并行 job（win-x64, win-arm64, mac-x64, mac-arm64）就是为了这个。

### Q: 双击 `.exe` 后没看到托盘图标

任务栏右下角 "显示隐藏的图标"（^ 箭头）展开里找。Windows 默认会把不常用图标折叠。

### Q: dev 模式（`npm --prefix package/desktop run dev`）能用吗

可以。dev 模式下：

- 优先用已 build 过的 `package/desktop/resources/sidecar/`
- 没 build 过就 fall back 到系统 `node` + 仓库根的 `dist/cli.js`（所以需要先 `npm run build`）

适合迭代调 UI / 主进程逻辑——比每次重打包快很多。

### Q: 打开 Admin UI 在 app 模式显示空白

确认 sidecar 已 running（看托盘状态 header 是不是绿点）。空白通常是 sidecar 没跑起来 → 检查 logs 窗。

### Q: 用 ChatGPT / Codex 把 mimo2codex 当代理时端口要填哪个

填托盘状态 header 上显示的那个（默认 8788，被占自动顺延）。Settings 窗的 Port 字段就是这个。

---

## 5. 下一步：到 GitHub Actions 出 release

本地验证没问题后：

1. 跑 `npm run release:patch`（或 minor/major）—— 提示让 release 脚本自己处理 git tag
2. **手动**把 git tag 改成 `v0.X.Y-desktop`（不是 `v0.X.Y`），push tag
3. GitHub Actions 上的 `build-desktop.yml` workflow（Phase 9.2 待实施）会按 matrix 跑 4 个平台 + 自动出 release

> Phase 9.2 / 10 / 11 还没实施。本地试通后再回来推进那部分。

---

**本地打包小抄（每次新版本）**：

```bash
npm run brand:icons               # 只有改了 logo 时
npm run sidecar:build             # CLI 改了或 Node 版本要换时
npm --prefix package/desktop run build
npm --prefix package/desktop run pack
# 产物：package/desktop/release/
```
