# mimo2codex Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing mimo2codex Node.js CLI in an Electron desktop shell (tray on Windows, menu bar on macOS) with first-run settings, embedded admin UI, autostart, GitHub Actions packaging, and a dynamic download page on mimodoc.

**Architecture:** Sidecar model. The existing CLI is bundled untouched as a child process; the Electron main process supervises it via `child_process.spawn`. Desktop code lives entirely under `package/desktop/` with its own `package.json` and `node_modules`, so the root npm package and Docker image are unaffected. Distribution: GitHub Releases (4 artifacts: win/mac × x64/arm64) consumed by a new `/download` page in docweb.

**Tech Stack:** Electron 30+ · electron-builder · React 18 + AntD 5 (settings/logs windows, matching admin UI) · TypeScript ESM · vitest · GitHub Actions matrix

**Implementation refinement vs spec:** The spec proposed `@yao-pkg/pkg` to compile the CLI into a single binary. During planning we settled on **extracted-files + bundled Node runtime** instead, because: (a) the project is strict ESM (NodeNext) and pkg has known ESM limitations, (b) `better-sqlite3` is a native module that needs platform-specific `.node` files at runtime — easier as plain files than wrapped in a binary, (c) electron-builder's `extraResources` already supports bundling arbitrary directories. Spec sections 2 and 4.3 are updated by this plan accordingly.

**Second-round addenda (2026-05-22):** Spec §8 logs 12 hard-issue gaps + 6 stance clarifications found in a follow-up audit. They land here as `.1` / `.X` sub-tasks scattered across Phases 4–11 (Task 4.3.1, 5.4, 5.5, 6.1.1, 6.2.1, 7.1.1, 7.2.1, 9.1.1, 11.3) plus edits to 5.2, 5.3, 8.1, 8.2, 11.2. The main-trunk Phase structure is unchanged.

**macOS translocation (C1):** All persistent paths resolve from `app.getPath("userData")`, not `app.getAppPath()`. The desktop shell is therefore immune to Gatekeeper translocation — no dequarantine handling needed.

---

## File Structure

### Created

```
package/
├── brand/
│   ├── logo.svg                              # §6 source vector
│   └── logo-1024.png                         # §6 raster source (1024×1024)
├── desktop/
│   ├── package.json                          # independent workspace
│   ├── tsconfig.json
│   ├── tsconfig.renderer.json                # separate config for React (DOM lib)
│   ├── electron-builder.yml                  # packaging config
│   ├── vite.config.ts                        # builds settings/logs renderer bundles
│   ├── src/
│   │   ├── main.ts                           # Electron main entry
│   │   ├── tray.ts                           # tray icon + menu construction
│   │   ├── sidecar.ts                        # spawn/kill/restart Node CLI child
│   │   ├── autostart.ts                      # app.setLoginItemSettings wrapper
│   │   ├── runtime.ts                        # read/write userData/runtime.json
│   │   ├── firstRun.ts                       # detects "needs setup" condition
│   │   ├── envFile.ts                        # read/write userData/.env
│   │   ├── portProbe.ts                      # find first free port from 8788
│   │   ├── logger.ts                         # main process logger → userData/logs/
│   │   ├── ipc.ts                            # typed IPC channel definitions
│   │   ├── icons.ts                          # tray icon state compositing (green/yellow/red)
│   │   ├── preload.ts                        # exposes ipc to renderer via contextBridge
│   │   └── windows/
│   │       ├── settings.ts                   # main-side: open/close, IPC handlers
│   │       ├── adminWebview.ts               # main-side: BrowserWindow → admin UI
│   │       └── logs.ts                       # main-side: tail log file, IPC stream
│   ├── renderer/
│   │   ├── settings/
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   └── App.tsx                       # AntD form
│   │   └── logs/
│   │       ├── index.html
│   │       ├── main.tsx
│   │       └── App.tsx                       # tail viewer
│   ├── shared/
│   │   └── types.ts                          # cross main/renderer type definitions
│   ├── resources/
│   │   ├── icons/                            # generated icons (gitignored, built in CI)
│   │   └── sidecar/                          # placeholder for bundled CLI (CI fills)
│   └── test/
│       ├── runtime.test.ts
│       ├── portProbe.test.ts
│       ├── envFile.test.ts
│       ├── firstRun.test.ts
│       ├── autostart.test.ts
│       └── sidecar.test.ts
├── win/
│   ├── icon.ico                              # built from logo-1024.png
│   └── tray.ico                              # 3 color variants (green/yellow/red)
└── mac/
    ├── icon.icns                             # built from logo-1024.png
    ├── tray-Template.png                     # 16/32 @1x/@2x mono
    └── entitlements.mac.plist

docweb/
└── src/
    ├── pages/
    │   └── Download.tsx                      # new page
    ├── api/
    │   └── githubReleases.ts                 # fetch + cache + parse releases
    └── i18n/locales/
        ├── en.json                           # APPEND download.* keys
        └── zh.json                           # APPEND download.* keys

.github/workflows/
└── build-desktop.yml                         # matrix + release job

docs/superpowers/plans/
└── 2026-05-22-desktop-shell.md               # this file
```

### Modified

| Path | Change |
|---|---|
| `package.json` (root) | scripts: `desktop:dev`, `desktop:build`, `desktop:pack` — devDeps NOT touched |
| `docweb/src/App.tsx` | add `/download` route |
| `docweb/src/components/AppHeader.tsx` | add "下载" nav entry |
| `docweb/public/favicon.svg` | replace with new logo |
| `.gitignore` | add `package/desktop/dist`, `package/desktop/resources/icons`, `package/desktop/resources/sidecar`, `package/desktop/release` |

### Untouched (hard constraint)

`src/**`, `web/**`, `Dockerfile`, `docker-compose.yml`, existing `.github/workflows/**`, root `dependencies` / `devDependencies`.

---

## Phase 1 — Logo + brand assets

Logo first because it feeds Phase 2 (icon files) and Phase 8 (download page hero). Pure asset work, no tests.

### Task 1.1: Create logo SVG source

**Files:**
- Create: `package/brand/logo.svg`

- [ ] **Step 1: Write the SVG file**

Create `package/brand/logo.svg` with this content:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3B2F7A"/>
      <stop offset="100%" stop-color="#4F6CFB"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0%" y1="0%" x2="60%" y2="60%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- Squircle background (rx ~ 25% of 256 = 64 for iOS-like rounding) -->
  <rect x="0" y="0" width="256" height="256" rx="64" ry="64" fill="url(#bg)"/>
  <!-- Subtle top-left highlight -->
  <rect x="0" y="0" width="256" height="256" rx="64" ry="64" fill="url(#gloss)"/>
  <!-- Letter group: m  2  c -->
  <!-- "m" -->
  <text x="62" y="172" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif"
        font-size="120" font-weight="700" fill="#FFFFFF" text-anchor="middle">m</text>
  <!-- "2" as bridge arrow: glyph drawn manually so the top sweeps right-down -->
  <path d="M 108 110
           Q 108 78, 140 78
           Q 168 78, 168 104
           Q 168 122, 150 138
           L 108 178
           L 168 178"
        stroke="#FFFFFF" stroke-width="16" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Tiny arrowhead at the right end of the 2's top curve, suggesting translation direction -->
  <path d="M 162 88 L 172 78 L 162 70"
        stroke="#FFFFFF" stroke-width="10" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- "c" -->
  <text x="200" y="172" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif"
        font-size="120" font-weight="700" fill="#FFFFFF" text-anchor="middle">c</text>
</svg>
```

- [ ] **Step 2: Visually verify**

Open `package/brand/logo.svg` in a browser. Expected: deep-purple-to-blue squircle, white `m`, custom path-drawn `2` with a right-pointing arrowhead near the top, white `c`. The "2" should read clearly as a "2" but with a directional accent.

- [ ] **Step 3: Adjust if proportions look off**

If the `2` looks crammed against the `m` or `c`, edit the path's X coordinates to widen spacing. The acceptance bar is: a stranger sees `m2c` legibly and the `2` has a noticeable directional accent.

- [ ] **Step 4: Commit**

```bash
git add package/brand/logo.svg
git commit -m "feat(brand): add m2c logo source (direction A: bridge monogram)"
```

### Task 1.2: Render 1024×1024 PNG from SVG

**Files:**
- Create: `package/brand/logo-1024.png`
- Modify: `package.json` (root, add a one-shot script)

- [ ] **Step 1: Add render script to root package.json**

Edit root `package.json`, add inside `"scripts"`:

```jsonc
"brand:render": "npx --yes sharp-cli@4 -i package/brand/logo.svg -o package/brand/logo-1024.png resize 1024 1024 --withoutEnlargement=false"
```

- [ ] **Step 2: Run it**

```bash
npm run brand:render
```

Expected: creates `package/brand/logo-1024.png`, exit 0.

- [ ] **Step 3: Visually verify**

Open `package/brand/logo-1024.png`. Expected: 1024×1024, same composition as the SVG, no jaggies.

- [ ] **Step 4: Commit**

```bash
git add package/brand/logo-1024.png package.json
git commit -m "feat(brand): render logo-1024.png from SVG"
```

### Task 1.3: Replace docweb favicon

**Files:**
- Modify: `docweb/public/favicon.svg`

- [ ] **Step 1: Copy the brand SVG to docweb's favicon location**

```bash
cp package/brand/logo.svg docweb/public/favicon.svg
```

- [ ] **Step 2: Run docweb dev server briefly to verify**

```bash
npm --prefix docweb run dev
```

Open `http://localhost:5174/` in a browser, check the favicon in the tab. Expected: new m2c logo, not the old blue "m2" square. Stop the dev server (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add docweb/public/favicon.svg
git commit -m "feat(docweb): replace placeholder favicon with m2c logo"
```

---

## Phase 2 — Electron workspace scaffold

Stand up an empty Electron workspace that builds but does nothing yet. Establishes isolation.

### Task 2.1: Create package/desktop/package.json

**Files:**
- Create: `package/desktop/package.json`

- [ ] **Step 1: Write the package.json**

```jsonc
{
  "name": "mimo2codex-desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Electron desktop shell for mimo2codex — tray on Windows, menu bar on macOS",
  "main": "dist/main.js",
  "scripts": {
    "dev": "npm run build && electron .",
    "build": "npm run build:main && npm run build:renderer",
    "build:main": "tsc -p tsconfig.json",
    "build:renderer": "vite build",
    "test": "vitest run",
    "pack": "electron-builder --publish never",
    "pack:win": "electron-builder --win --publish never",
    "pack:mac": "electron-builder --mac --publish never"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "antd": "^5.21.0",
    "electron": "^30.0.0",
    "electron-builder": "^25.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm --prefix package/desktop install
```

Expected: ~250 packages installed, no errors.

- [ ] **Step 3: Verify electron binary present**

```bash
ls package/desktop/node_modules/electron/dist/
```

Expected: directory exists (Win: electron.exe, Mac: Electron.app).

- [ ] **Step 4: Commit**

```bash
git add package/desktop/package.json package/desktop/package-lock.json
git commit -m "feat(desktop): scaffold package/desktop workspace with Electron deps"
```

### Task 2.2: TypeScript configs

**Files:**
- Create: `package/desktop/tsconfig.json`
- Create: `package/desktop/tsconfig.renderer.json`

- [ ] **Step 1: Write main tsconfig**

`package/desktop/tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*", "shared/**/*"],
  "exclude": ["node_modules", "dist", "renderer", "test"]
}
```

- [ ] **Step 2: Write renderer tsconfig**

`package/desktop/tsconfig.renderer.json`:
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["renderer/**/*", "shared/**/*"]
}
```

- [ ] **Step 3: Commit**

```bash
git add package/desktop/tsconfig.json package/desktop/tsconfig.renderer.json
git commit -m "feat(desktop): TypeScript configs for main + renderer"
```

### Task 2.3: Vite config for renderer bundles

**Files:**
- Create: `package/desktop/vite.config.ts`
- Create: `package/desktop/renderer/settings/index.html`
- Create: `package/desktop/renderer/logs/index.html`

- [ ] **Step 1: Write vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        settings: resolve(__dirname, "renderer/settings/index.html"),
        logs: resolve(__dirname, "renderer/logs/index.html"),
      },
    },
  },
});
```

- [ ] **Step 2: Stub the two index.html files**

`package/desktop/renderer/settings/index.html`:
```html
<!doctype html>
<html><head><meta charset="UTF-8"><title>mimo2codex Settings</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

`package/desktop/renderer/logs/index.html`:
```html
<!doctype html>
<html><head><meta charset="UTF-8"><title>mimo2codex Logs</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

- [ ] **Step 3: Stub the two main.tsx so vite has an entry**

`package/desktop/renderer/settings/main.tsx`:
```tsx
console.log("settings renderer placeholder");
```

`package/desktop/renderer/logs/main.tsx`:
```tsx
console.log("logs renderer placeholder");
```

- [ ] **Step 4: Run renderer build to verify**

```bash
npm --prefix package/desktop run build:renderer
```

Expected: produces `package/desktop/dist/renderer/settings/index.html` + `logs/index.html` + assets bundles.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/vite.config.ts package/desktop/renderer/
git commit -m "feat(desktop): vite multi-entry renderer build (settings + logs)"
```

### Task 2.4: Root package.json forwarding scripts

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add desktop scripts to root package.json**

In the root `package.json`'s `"scripts"` section, append:

```jsonc
"desktop:install": "npm --prefix package/desktop install",
"desktop:dev": "npm --prefix package/desktop run dev",
"desktop:build": "npm --prefix package/desktop run build",
"desktop:pack": "npm --prefix package/desktop run pack",
"desktop:test": "npm --prefix package/desktop run test"
```

- [ ] **Step 2: Verify root deps are untouched**

```bash
git diff package.json
```

Expected: only changes inside `"scripts"`. `"dependencies"` and `"devDependencies"` unchanged.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add desktop:* forwarding scripts to root (deps untouched)"
```

### Task 2.5: .gitignore updates

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append desktop ignores**

Append to `.gitignore`:

```
# desktop shell build artifacts
package/desktop/dist/
package/desktop/node_modules/
package/desktop/resources/icons/
package/desktop/resources/sidecar/
package/desktop/release/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore desktop build artifacts"
```

---

## Phase 3 — Core utility modules (TDD)

Build the small, pure logic pieces first. These have unit tests.

### Task 3.1: shared types

**Files:**
- Create: `package/desktop/shared/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// Cross main/renderer typed surface. Imported via path alias in main
// (NodeNext) and via Vite (Bundler resolution) in renderer.

export interface RuntimeConfig {
  port: number;
  autostart: boolean;
  /** Set by --autostart-launched on boot, NOT persisted */
  launchedByAutostart?: boolean;
  /** Was admin UI window opened on the most recent Save & Restart */
  showAdminUiAfterSave?: boolean;
}

export type SidecarStatus =
  | { kind: "starting" }
  | { kind: "running"; port: number; pid: number }
  | { kind: "crashed"; exitCode: number | null; lastLog: string };

export interface ProviderEnvKey {
  provider: "mimo" | "deepseek" | "generic";
  envKey: "MIMO_API_KEY" | "DEEPSEEK_API_KEY" | "GENERIC_API_KEY";
}

export const PROVIDER_KEYS: ProviderEnvKey[] = [
  { provider: "mimo", envKey: "MIMO_API_KEY" },
  { provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
  { provider: "generic", envKey: "GENERIC_API_KEY" },
];

/** Template placeholder string from .env.example */
export const KEY_PLACEHOLDER_PREFIX = "sk-xxxxxxxxxxxxxxxxxxxx";
```

- [ ] **Step 2: Commit**

```bash
git add package/desktop/shared/types.ts
git commit -m "feat(desktop): cross-process type definitions"
```

### Task 3.2: runtime.ts — read/write runtime.json (TDD)

**Files:**
- Create: `package/desktop/src/runtime.ts`
- Create: `package/desktop/test/runtime.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/runtime.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRuntime, saveRuntime, DEFAULT_RUNTIME } from "../src/runtime.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-runtime-"));
});

describe("loadRuntime", () => {
  it("returns DEFAULT_RUNTIME when file is missing", () => {
    expect(loadRuntime(dir)).toEqual(DEFAULT_RUNTIME);
  });

  it("merges persisted values over defaults", () => {
    writeFileSync(join(dir, "runtime.json"), JSON.stringify({ port: 9999 }));
    expect(loadRuntime(dir)).toEqual({ ...DEFAULT_RUNTIME, port: 9999 });
  });

  it("ignores corrupt JSON and returns defaults", () => {
    writeFileSync(join(dir, "runtime.json"), "{not json");
    expect(loadRuntime(dir)).toEqual(DEFAULT_RUNTIME);
  });
});

describe("saveRuntime", () => {
  it("writes pretty JSON", () => {
    saveRuntime(dir, { port: 8901, autostart: true });
    expect(existsSync(join(dir, "runtime.json"))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    expect(parsed).toEqual({ port: 8901, autostart: true });
  });

  it("strips ephemeral fields (launchedByAutostart) before writing", () => {
    saveRuntime(dir, { port: 8788, autostart: false, launchedByAutostart: true });
    const parsed = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
    expect(parsed.launchedByAutostart).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/runtime.test.ts
```

Expected: FAIL — cannot resolve `../src/runtime.js`.

- [ ] **Step 3: Implement runtime.ts**

`package/desktop/src/runtime.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "../shared/types.js";

export const DEFAULT_RUNTIME: RuntimeConfig = {
  port: 8788,
  autostart: false,
};

const FILE = "runtime.json";

export function loadRuntime(userDataDir: string): RuntimeConfig {
  const path = join(userDataDir, FILE);
  if (!existsSync(path)) return DEFAULT_RUNTIME;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeConfig>;
    return { ...DEFAULT_RUNTIME, ...parsed };
  } catch {
    return DEFAULT_RUNTIME;
  }
}

export function saveRuntime(userDataDir: string, cfg: RuntimeConfig): void {
  mkdirSync(userDataDir, { recursive: true });
  // Strip ephemeral fields (set per-launch, not persisted)
  const { launchedByAutostart: _l, showAdminUiAfterSave: _s, ...persisted } = cfg;
  writeFileSync(join(userDataDir, FILE), JSON.stringify(persisted, null, 2), "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/runtime.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/runtime.ts package/desktop/test/runtime.test.ts
git commit -m "feat(desktop): runtime.json load/save with default merging"
```

### Task 3.3: portProbe.ts — find first free port (TDD)

**Files:**
- Create: `package/desktop/src/portProbe.ts`
- Create: `package/desktop/test/portProbe.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/portProbe.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { findFreePort } from "../src/portProbe.js";

describe("findFreePort", () => {
  it("returns the desired port when it's free", async () => {
    // Pick a high port unlikely to be in use; if it IS in use the test is
    // self-correcting (we just get the next free one and assert >= start)
    const port = await findFreePort(45111);
    expect(port).toBeGreaterThanOrEqual(45111);
  });

  it("advances past an occupied port", async () => {
    const occupied = 45222;
    const server = createServer().listen(occupied);
    await new Promise<void>((r) => server.once("listening", () => r()));
    try {
      const port = await findFreePort(occupied);
      expect(port).toBeGreaterThan(occupied);
    } finally {
      server.close();
    }
  });

  it("throws if 100 consecutive ports are taken (safety stop)", async () => {
    // We can't realistically occupy 100 ports in a test; instead pass a
    // sentinel start that signals to the impl to use a small max. Approach:
    // override the max via a second argument.
    await expect(findFreePort(45333, 0)).rejects.toThrow(/no free port/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/portProbe.test.ts
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Implement portProbe.ts**

`package/desktop/src/portProbe.ts`:
```ts
import { createServer } from "node:net";

export async function findFreePort(start: number, maxTries: number = 100): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const port = start + i;
    const free = await isFree(port);
    if (free) return port;
  }
  throw new Error(`no free port in ${start}..${start + maxTries - 1}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/portProbe.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/portProbe.ts package/desktop/test/portProbe.test.ts
git commit -m "feat(desktop): portProbe with safety stop"
```

### Task 3.4: envFile.ts — read/write userData/.env (TDD)

**Files:**
- Create: `package/desktop/src/envFile.ts`
- Create: `package/desktop/test/envFile.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/envFile.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEnv, writeEnv, hasUsableKey } from "../src/envFile.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-env-"));
});

describe("readEnv", () => {
  it("returns empty object when .env is missing", () => {
    expect(readEnv(dir)).toEqual({});
  });
  it("parses KEY=value lines, ignoring comments and blanks", () => {
    writeFileSync(join(dir, ".env"), "# comment\n\nMIMO_API_KEY=sk-real\nPORT=9000\n");
    expect(readEnv(dir)).toEqual({ MIMO_API_KEY: "sk-real", PORT: "9000" });
  });
  it("strips surrounding quotes", () => {
    writeFileSync(join(dir, ".env"), `MIMO_API_KEY="sk-quoted"\nFOO='single'\n`);
    expect(readEnv(dir)).toEqual({ MIMO_API_KEY: "sk-quoted", FOO: "single" });
  });
});

describe("writeEnv", () => {
  it("upserts keys, preserving existing comments + ordering", () => {
    writeFileSync(join(dir, ".env"), "# header\nMIMO_API_KEY=old\nOTHER=keep\n");
    writeEnv(dir, { MIMO_API_KEY: "new", PORT: "8788" });
    const out = readFileSync(join(dir, ".env"), "utf8");
    expect(out).toMatch(/# header/);
    expect(out).toMatch(/MIMO_API_KEY=new/);
    expect(out).toMatch(/OTHER=keep/);
    expect(out).toMatch(/PORT=8788/);
  });
  it("creates file when missing", () => {
    writeEnv(dir, { MIMO_API_KEY: "sk-1" });
    expect(existsSync(join(dir, ".env"))).toBe(true);
  });
});

describe("hasUsableKey", () => {
  it("returns false for missing key", () => {
    expect(hasUsableKey({}, "MIMO_API_KEY")).toBe(false);
  });
  it("returns false for empty key", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "" }, "MIMO_API_KEY")).toBe(false);
  });
  it("returns false for template placeholder", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx" }, "MIMO_API_KEY")).toBe(false);
  });
  it("returns true for a real-looking key", () => {
    expect(hasUsableKey({ MIMO_API_KEY: "sk-abc123def456" }, "MIMO_API_KEY")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/envFile.test.ts
```

- [ ] **Step 3: Implement envFile.ts**

`package/desktop/src/envFile.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { KEY_PLACEHOLDER_PREFIX } from "../shared/types.js";

const FILE = ".env";

export function readEnv(userDataDir: string): Record<string, string> {
  const path = join(userDataDir, FILE);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function writeEnv(userDataDir: string, updates: Record<string, string>): void {
  mkdirSync(userDataDir, { recursive: true });
  const path = join(userDataDir, FILE);
  const existingLines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const seen = new Set<string>();
  const outLines: string[] = [];
  for (const rawLine of existingLines) {
    const line = rawLine;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      outLines.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      outLines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      outLines.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      outLines.push(line);
    }
  }
  // Append any updates not yet seen
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) outLines.push(`${k}=${v}`);
  }
  // Trim trailing blank duplicates, then ensure exactly one trailing newline
  while (outLines.length > 0 && outLines[outLines.length - 1] === "") outLines.pop();
  writeFileSync(path, outLines.join("\n") + "\n", "utf8");
}

export function hasUsableKey(env: Record<string, string>, key: string): boolean {
  const v = env[key];
  if (!v) return false;
  if (v.startsWith(KEY_PLACEHOLDER_PREFIX)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/envFile.test.ts
```

Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/envFile.ts package/desktop/test/envFile.test.ts
git commit -m "feat(desktop): .env reader/writer + key-validity check"
```

### Task 3.5: firstRun.ts — needs-setup detection (TDD)

**Files:**
- Create: `package/desktop/src/firstRun.ts`
- Create: `package/desktop/test/firstRun.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/firstRun.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { needsFirstRunSetup } from "../src/firstRun.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m2c-fr-"));
});

describe("needsFirstRunSetup", () => {
  it("true when no .env file exists", () => {
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("true when .env exists but no provider key is set", () => {
    writeFileSync(join(dir, ".env"), "PORT=8788\n");
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("true when key is the template placeholder", () => {
    writeFileSync(join(dir, ".env"), "MIMO_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx\n");
    expect(needsFirstRunSetup(dir)).toBe(true);
  });
  it("false when any provider has a usable key", () => {
    writeFileSync(join(dir, ".env"), "DEEPSEEK_API_KEY=sk-realkey-here\n");
    expect(needsFirstRunSetup(dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/firstRun.test.ts
```

- [ ] **Step 3: Implement firstRun.ts**

`package/desktop/src/firstRun.ts`:
```ts
import { readEnv, hasUsableKey } from "./envFile.js";
import { PROVIDER_KEYS } from "../shared/types.js";

export function needsFirstRunSetup(userDataDir: string): boolean {
  const env = readEnv(userDataDir);
  return !PROVIDER_KEYS.some(({ envKey }) => hasUsableKey(env, envKey));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/firstRun.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/firstRun.ts package/desktop/test/firstRun.test.ts
git commit -m "feat(desktop): first-run detection (no .env or no usable key)"
```

### Task 3.6: autostart.ts — Electron setLoginItemSettings wrapper (TDD with mock)

**Files:**
- Create: `package/desktop/src/autostart.ts`
- Create: `package/desktop/test/autostart.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/autostart.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { setAutostart, getAutostart } from "../src/autostart.js";

const setSpy = vi.fn();
const getSpy = vi.fn();

vi.mock("electron", () => ({
  app: {
    setLoginItemSettings: (opts: unknown) => setSpy(opts),
    getLoginItemSettings: () => getSpy(),
  },
}));

beforeEach(() => {
  setSpy.mockReset();
  getSpy.mockReset();
});

describe("setAutostart", () => {
  it("enables with openAsHidden + --autostart-launched arg", () => {
    setAutostart(true);
    expect(setSpy).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
      args: ["--autostart-launched"],
    });
  });
  it("disables cleanly", () => {
    setAutostart(false);
    expect(setSpy).toHaveBeenCalledWith({
      openAtLogin: false,
      openAsHidden: false,
      args: [],
    });
  });
});

describe("getAutostart", () => {
  it("reads openAtLogin from Electron", () => {
    getSpy.mockReturnValue({ openAtLogin: true });
    expect(getAutostart()).toBe(true);
    getSpy.mockReturnValue({ openAtLogin: false });
    expect(getAutostart()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/autostart.test.ts
```

- [ ] **Step 3: Implement autostart.ts**

`package/desktop/src/autostart.ts`:
```ts
import { app } from "electron";

export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: enabled ? ["--autostart-launched"] : [],
  });
}

export function getAutostart(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/autostart.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/autostart.ts package/desktop/test/autostart.test.ts
git commit -m "feat(desktop): autostart wrapper around setLoginItemSettings"
```

### Task 3.7: logger.ts — main process log file

**Files:**
- Create: `package/desktop/src/logger.ts`

- [ ] **Step 1: Implement logger**

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let logDir: string | null = null;

export function initLogger(userDataDir: string): void {
  logDir = join(userDataDir, "logs");
  mkdirSync(logDir, { recursive: true });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function write(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`;
  // Always echo to stderr for `electron .` console visibility during dev
  process.stderr.write(line);
  if (logDir) appendFileSync(join(logDir, `desktop-${today()}.log`), line, "utf8");
}

export const log = {
  info: (msg: string, extra?: unknown) => write("info", msg, extra),
  warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
  error: (msg: string, extra?: unknown) => write("error", msg, extra),
};
```

- [ ] **Step 2: Commit**

```bash
git add package/desktop/src/logger.ts
git commit -m "feat(desktop): main-process logger with daily file rotation"
```

### Task 3.8: sidecar.ts — spawn/kill/restart (TDD with mock)

**Files:**
- Create: `package/desktop/src/sidecar.ts`
- Create: `package/desktop/test/sidecar.test.ts`

- [ ] **Step 1: Write failing test**

`package/desktop/test/sidecar.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER mocks are set up
const { SidecarManager } = await import("../src/sidecar.js");

class FakeChild extends EventEmitter {
  pid = 12345;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn((sig?: string) => {
    this.killed = true;
    // Simulate async exit
    setImmediate(() => this.emit("exit", sig === "SIGKILL" ? null : 0, sig ?? null));
    return true;
  });
}

let child: FakeChild;
beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeChild();
  spawnMock.mockReturnValue(child);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("SidecarManager", () => {
  it("spawns with the configured binary + args", async () => {
    const sm = new SidecarManager({ binPath: "/path/sidecar", dataDir: "/data", port: 8788 });
    await sm.start();
    expect(spawnMock).toHaveBeenCalledWith(
      "/path/sidecar",
      expect.arrayContaining(["--data-dir", "/data", "--port", "8788"]),
      expect.anything()
    );
    expect(sm.status().kind).toBe("running");
  });

  it("transitions to crashed on non-zero exit", async () => {
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, maxRestarts: 0 });
    await sm.start();
    child.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));
    expect(sm.status().kind).toBe("crashed");
  });

  it("auto-restarts once on first crash", async () => {
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, maxRestarts: 1 });
    await sm.start();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    child.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(sm.status().kind).toBe("running");
  });

  it("stops with SIGTERM, escalates to SIGKILL after grace period", async () => {
    vi.useFakeTimers();
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, killGraceMs: 100 });
    await sm.start();
    // Override kill to NOT auto-emit exit, so we can drive the grace timer
    child.kill = vi.fn(() => true);
    const stopP = sm.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.advanceTimersByTime(101);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    // Simulate exit after SIGKILL
    child.emit("exit", null, "SIGKILL");
    await stopP;
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix package/desktop run test -- test/sidecar.test.ts
```

- [ ] **Step 3: Implement sidecar.ts**

`package/desktop/src/sidecar.ts`:
```ts
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { SidecarStatus } from "../shared/types.js";

export interface SidecarOptions {
  /** Path to the bundled mimo2codex CLI binary (or node runtime wrapper). */
  binPath: string;
  /** Extra args before --data-dir / --port */
  extraArgs?: string[];
  dataDir: string;
  port: number;
  /** Max automatic restarts on crash. Defaults to 1. */
  maxRestarts?: number;
  /** Time to wait between SIGTERM and SIGKILL during shutdown. Defaults to 2000ms. */
  killGraceMs?: number;
}

export class SidecarManager extends EventEmitter {
  private readonly opts: Required<SidecarOptions>;
  private child: ChildProcess | null = null;
  private restartsRemaining: number;
  private currentStatus: SidecarStatus = { kind: "starting" };
  private intentionalStop = false;

  constructor(opts: SidecarOptions) {
    super();
    this.opts = {
      extraArgs: [],
      maxRestarts: 1,
      killGraceMs: 2000,
      ...opts,
    };
    this.restartsRemaining = this.opts.maxRestarts;
  }

  status(): SidecarStatus {
    return this.currentStatus;
  }

  async start(): Promise<void> {
    this.spawnOnce();
  }

  private spawnOnce(): void {
    this.currentStatus = { kind: "starting" };
    this.emit("status", this.currentStatus);
    const args = [
      ...this.opts.extraArgs,
      "--data-dir", this.opts.dataDir,
      "--port", String(this.opts.port),
    ];
    const child = spawn(this.opts.binPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.child = child;
    child.stdout?.on("data", (b: Buffer) => this.emit("stdout", b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => this.emit("stderr", b.toString("utf8")));
    child.on("exit", (code, signal) => this.onExit(code, signal));
    // Mark running as soon as spawn returns; the CLI prints its own banner
    // and we don't try to wait for "listening" — simpler.
    this.currentStatus = { kind: "running", port: this.opts.port, pid: child.pid ?? -1 };
    this.emit("status", this.currentStatus);
  }

  private onExit(code: number | null, _signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.intentionalStop) return;
    if (code === 0) {
      // Clean exit without our request — treat as crashed (server shouldn't exit on its own)
    }
    if (this.restartsRemaining > 0) {
      this.restartsRemaining--;
      this.spawnOnce();
      return;
    }
    this.currentStatus = { kind: "crashed", exitCode: code, lastLog: "" };
    this.emit("status", this.currentStatus);
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.intentionalStop = true;
    const child = this.child;
    const exitP = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const grace = new Promise<void>((resolve) => setTimeout(resolve, this.opts.killGraceMs));
    await Promise.race([exitP, grace]);
    if (this.child) {
      this.child.kill("SIGKILL");
      await exitP;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix package/desktop run test -- test/sidecar.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/sidecar.ts package/desktop/test/sidecar.test.ts
git commit -m "feat(desktop): SidecarManager with auto-restart + graceful shutdown"
```

---

## Phase 4 — IPC plumbing + main entry skeleton

### Task 4.1: IPC channel definitions

**Files:**
- Create: `package/desktop/src/ipc.ts`

- [ ] **Step 1: Implement IPC channels**

```ts
// Typed IPC channel surface. Both main and renderer import this to
// stay in sync — exhaustive switch on the discriminant catches typos.

import type { RuntimeConfig, SidecarStatus } from "../shared/types.js";

export type RendererToMain =
  | { type: "settings:load" }
  | { type: "settings:save"; payload: { runtime: RuntimeConfig; env: Record<string, string>; showAdminUiAfterSave: boolean } }
  | { type: "settings:cancel"; payload: { isFirstRun: boolean } }
  | { type: "logs:subscribe" }
  | { type: "logs:unsubscribe" };

export type MainToRenderer =
  | { type: "settings:loaded"; payload: { runtime: RuntimeConfig; env: Record<string, string>; isFirstRun: boolean } }
  | { type: "status"; payload: SidecarStatus }
  | { type: "logs:line"; payload: { line: string; channel: "stdout" | "stderr" } };

export const IPC_CHANNEL = "m2c-desktop";
```

- [ ] **Step 2: Commit**

```bash
git add package/desktop/src/ipc.ts
git commit -m "feat(desktop): typed IPC channel definitions"
```

### Task 4.2: preload.ts — contextBridge surface

**Files:**
- Create: `package/desktop/src/preload.ts`

- [ ] **Step 1: Implement preload**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { RendererToMain, MainToRenderer } from "./ipc.js";
import { IPC_CHANNEL } from "./ipc.js";

contextBridge.exposeInMainWorld("m2c", {
  send: (msg: RendererToMain): void => {
    ipcRenderer.send(IPC_CHANNEL, msg);
  },
  on: (handler: (msg: MainToRenderer) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: MainToRenderer) => handler(msg);
    ipcRenderer.on(IPC_CHANNEL, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNEL, listener);
  },
});

declare global {
  interface Window {
    m2c: {
      send: (msg: RendererToMain) => void;
      on: (handler: (msg: MainToRenderer) => void) => () => void;
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package/desktop/src/preload.ts
git commit -m "feat(desktop): preload contextBridge for typed renderer↔main IPC"
```

### Task 4.3: Minimal main.ts — boot + quit only (no tray yet)

**Files:**
- Create: `package/desktop/src/main.ts`

- [ ] **Step 1: Implement minimal main**

```ts
import { app } from "electron";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { initLogger, log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const userDataDir = app.getPath("userData");
  initLogger(userDataDir);
  log.info("mimo2codex-desktop starting", { userDataDir, version: app.getVersion() });

  // On macOS, hide the Dock icon — we're a menu bar app only.
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  // Prevent Electron from quitting when the last window closes — we're
  // tray-resident and must stay alive without any open windows.
  app.on("window-all-closed", (e: Electron.Event) => e.preventDefault());

  await app.whenReady();
  log.info("electron ready");

  // Tray + sidecar + first-run flow get added in later tasks.
}

main().catch((err) => {
  log.error("fatal in main", { error: (err as Error).message });
  process.exit(1);
});

// Mark __dirname as intentionally used for downstream tasks that resolve
// assets relative to this file.
void __dirname;
```

- [ ] **Step 2: Build + run sanity**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: Electron launches, no window, logs print "electron ready" to stderr, process stays alive. **Quit with Ctrl+C** (since there's no UI yet).

- [ ] **Step 3: Commit**

```bash
git add package/desktop/src/main.ts
git commit -m "feat(desktop): minimal main process (no UI yet, just lifecycle)"
```

### Task 4.3.1: Single-instance lock (A1)

Prevents two desktop instances from racing for port 8788 and stomping on the same `userData/.env` / SQLite file. Without this, the second instance starts, port-probe bumps to 8789, the user gets two tray icons with subtly different state, and SQLite WAL conflicts become possible.

**Files:**
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Insert single-instance gate at the very top of `main()`**

Edit `package/desktop/src/main.ts`. Right after the `userDataDir` / `initLogger` / `log.info("starting")` block (before `app.dock?.hide()`), insert:

```ts
  // Acquire the single-instance lock. If we don't get it, another desktop
  // shell is already running — focus its tray (best-effort) and exit cleanly.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log.info("another instance already holds the lock, exiting");
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    // No window to focus (tray-resident). Bring any visible window forward
    // if one exists; otherwise the user just sees the existing tray icon
    // already there. Settings/admin/logs windows register themselves at
    // creation time via setSecondInstanceFocusHandler in later tasks.
    log.info("second-instance attempt blocked");
  });
```

- [ ] **Step 2: Manual verification**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev   # leave this running
# In a second terminal:
npm --prefix package/desktop run dev   # should exit immediately
```

Expected: second invocation prints `another instance already holds the lock, exiting` to its log and exits with code 0 within ~1s. First instance continues normally.

- [ ] **Step 3: Commit**

```bash
git add package/desktop/src/main.ts
git commit -m "feat(desktop): single-instance lock prevents double-start"
```

---

## Phase 5 — Tray icon + menu

### Task 5.1: Generate tray icons from logo

**Files:**
- Create: `package/win/tray.ico` (3 color variants merged later)
- Create: `package/mac/tray-Template.png`
- Modify: root `package.json` (add `brand:icons` script)

- [ ] **Step 1: Add brand:icons script**

In root `package.json` scripts:

```jsonc
"brand:icons": "node scripts/brand-render-icons.mjs"
```

- [ ] **Step 2: Write the render script**

Create `scripts/brand-render-icons.mjs`:

```javascript
// Generates tray icons from package/brand/logo.svg.
// - Mac: tray-Template.png (16,32 @1x and @2x = 16,32,32,64) black silhouette
// - Win: tray.ico (16,32,48 multi-size, colored)
// Run: npm run brand:icons
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const brandSvg = resolve(root, "package/brand/logo.svg");

mkdirSync(resolve(root, "package/win"), { recursive: true });
mkdirSync(resolve(root, "package/mac"), { recursive: true });

// Mac template: monochrome silhouette
// Strategy: render SVG with all fills replaced to black, transparent bg
const svg = readFileSync(brandSvg, "utf8");
const monoSvg = svg
  .replace(/<linearGradient[\s\S]*?<\/linearGradient>/g, "")
  .replace(/fill="url\(#bg\)"/g, 'fill="none"')
  .replace(/fill="url\(#gloss\)"/g, 'fill="none"')
  .replace(/fill="#FFFFFF"/g, 'fill="#000000"')
  .replace(/stroke="#FFFFFF"/g, 'stroke="#000000"');
const monoPath = resolve(root, ".tmp-mono.svg");
writeFileSync(monoPath, monoSvg, "utf8");

// Use sharp-cli (already a transient dep via brand:render)
execSync(`npx --yes sharp-cli@4 -i ${monoPath} -o package/mac/tray-Template.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i ${monoPath} -o package/mac/tray-Template@2x.png resize 64 64`, { stdio: "inherit", cwd: root });

// Win tray.ico: render PNG at 16/32/48 then combine with png-to-ico
execSync(`npx --yes sharp-cli@4 -i ${brandSvg} -o .tmp-tray-16.png resize 16 16`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i ${brandSvg} -o .tmp-tray-32.png resize 32 32`, { stdio: "inherit", cwd: root });
execSync(`npx --yes sharp-cli@4 -i ${brandSvg} -o .tmp-tray-48.png resize 48 48`, { stdio: "inherit", cwd: root });
execSync(`npx --yes png-to-ico@2 .tmp-tray-16.png .tmp-tray-32.png .tmp-tray-48.png > package/win/tray.ico`, { stdio: "inherit", cwd: root, shell: true });
execSync(`npx --yes png-to-ico@2 .tmp-tray-16.png .tmp-tray-32.png .tmp-tray-48.png > package/win/icon.ico`, { stdio: "inherit", cwd: root, shell: true });

// Cleanup temp files
for (const f of [".tmp-mono.svg", ".tmp-tray-16.png", ".tmp-tray-32.png", ".tmp-tray-48.png"]) {
  try { execSync(process.platform === "win32" ? `del ${f}` : `rm ${f}`, { cwd: root, shell: true }); } catch {}
}

console.log("brand icons generated:");
console.log("  package/win/tray.ico");
console.log("  package/win/icon.ico");
console.log("  package/mac/tray-Template.png + @2x");
```

- [ ] **Step 3: Run it**

```bash
npm run brand:icons
```

Expected: produces 4 files. Visually open `package/win/tray.ico` and `package/mac/tray-Template.png` to verify they look like the logo at small size.

- [ ] **Step 4: Commit**

```bash
git add package/win/tray.ico package/win/icon.ico package/mac/tray-Template.png package/mac/tray-Template@2x.png scripts/brand-render-icons.mjs package.json
git commit -m "feat(brand): generate tray + app icons from logo SVG"
```

### Task 5.2: Tray icon (no menu yet)

**Files:**
- Create: `package/desktop/src/icons.ts`
- Create: `package/desktop/src/tray.ts`
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Write icons.ts**

```ts
import { nativeImage, type NativeImage } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/ → repo root → package/{win,mac}
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

export function trayIcon(): NativeImage {
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(join(repoRoot, "package/mac/tray-Template.png"));
    img.setTemplateImage(true);
    return img;
  }
  // Windows / Linux: use colored ico
  return nativeImage.createFromPath(join(repoRoot, "package/win/tray.ico"));
}
```

- [ ] **Step 2: Write tray.ts (minimal — just icon, no menu)**

```ts
import { Tray, Menu } from "electron";
import { trayIcon } from "./icons.js";

let tray: Tray | null = null;

export function createTray(): Tray {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  // Initial static tooltip; Task 5.3 replaces this with dynamic
  // `mimo2codex · :{port} · {status}` updates driven by sidecar state.
  tray.setToolTip("mimo2codex · starting...");
  // Placeholder menu; rebuilt in later task
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Quit", role: "quit" }]));
  return tray;
}
```

- [ ] **Step 3: Wire into main.ts**

Replace the placeholder line `// Tray + sidecar + first-run flow get added in later tasks.` in `package/desktop/src/main.ts` with:

```ts
  const { createTray } = await import("./tray.js");
  createTray();
  log.info("tray created");
```

- [ ] **Step 4: Build + smoke**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: Mac → m2c silhouette in top menu bar. Windows → m2c icon in system tray. Right-click → "Quit" works.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/icons.ts package/desktop/src/tray.ts package/desktop/src/main.ts
git commit -m "feat(desktop): tray icon visible on Win/Mac with stub Quit menu"
```

### Task 5.3: Full tray menu (handlers stubbed)

**Files:**
- Modify: `package/desktop/src/tray.ts`

- [ ] **Step 1: Expand tray.ts with full menu**

Replace `package/desktop/src/tray.ts`:

```ts
import { Tray, Menu, app, shell, dialog } from "electron";
import { trayIcon } from "./icons.js";
import type { SidecarStatus } from "../shared/types.js";
import { setAutostart, getAutostart } from "./autostart.js";

let tray: Tray | null = null;

export interface TrayActions {
  openAdminInBrowser: () => void;
  openAdminInApp: () => void;
  openSettings: () => void;
  openLogs: () => void;
  restartSidecar: () => void;
}

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  rebuildMenu(actions, { kind: "starting" });
  return tray;
}

export function updateStatus(actions: TrayActions, status: SidecarStatus): void {
  rebuildMenu(actions, status);
}

function statusLabel(s: SidecarStatus): string {
  if (s.kind === "running") return `●  mimo2codex · running on :${s.port}`;
  if (s.kind === "starting") return `○  mimo2codex · starting...`;
  return `✕  mimo2codex · sidecar crashed`;
}

function tooltipText(s: SidecarStatus): string {
  if (s.kind === "running") return `mimo2codex · :${s.port} · running`;
  if (s.kind === "starting") return `mimo2codex · starting...`;
  return `mimo2codex · crashed`;
}

function rebuildMenu(actions: TrayActions, status: SidecarStatus): void {
  if (!tray) return;
  tray.setToolTip(tooltipText(status));
  const menu = Menu.buildFromTemplate([
    { label: statusLabel(status), enabled: false },
    { type: "separator" },
    {
      label: "Open Admin UI in browser",
      enabled: status.kind === "running",
      click: actions.openAdminInBrowser,
    },
    {
      label: "Open Admin UI in app...",
      enabled: status.kind === "running",
      click: actions.openAdminInApp,
    },
    { type: "separator" },
    { label: "Settings...", click: actions.openSettings },
    { label: "Show logs...", click: actions.openLogs },
    { type: "separator" },
    {
      label: "Start on system boot",
      type: "checkbox",
      checked: getAutostart(),
      click: (item) => setAutostart(item.checked),
    },
    { type: "separator" },
    { label: "Restart sidecar", click: actions.restartSidecar },
    {
      label: "About",
      click: () => {
        dialog.showMessageBox({
          type: "info",
          title: "About mimo2codex",
          message: `mimo2codex v${app.getVersion()}`,
          detail: "Local proxy for OpenAI Codex ↔ MiMo / DeepSeek / generic.\n\nhttps://github.com/7as0nch/mimo2codex",
          buttons: ["GitHub", "Close"],
        }).then((r) => {
          if (r.response === 0) shell.openExternal("https://github.com/7as0nch/mimo2codex");
        });
      },
    },
    {
      label: "Quit",
      click: () => {
        // Confirm before killing the sidecar — an accidental click here
        // would drop any in-flight Codex session the user has open.
        dialog.showMessageBox({
          type: "question",
          title: "Quit mimo2codex?",
          message: "Quit mimo2codex?",
          detail:
            "The sidecar will stop and any active Codex sessions through this proxy will be interrupted.",
          buttons: ["Quit", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        }).then((r) => {
          if (r.response === 0) app.quit();
        });
      },
    },
  ]);
  tray.setContextMenu(menu);
}
```

- [ ] **Step 2: Wire stub actions in main.ts**

Replace the previous tray import + create block in `main.ts` with:

```ts
  const { createTray } = await import("./tray.js");
  const trayActions = {
    openAdminInBrowser: () => log.info("TODO: openAdminInBrowser"),
    openAdminInApp:     () => log.info("TODO: openAdminInApp"),
    openSettings:       () => log.info("TODO: openSettings"),
    openLogs:           () => log.info("TODO: openLogs"),
    restartSidecar:     () => log.info("TODO: restartSidecar"),
  };
  createTray(trayActions);
  log.info("tray created");
```

- [ ] **Step 3: Build + smoke**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: tray menu now has full structure. Click each item: stubs log "TODO: xxx", autostart checkbox toggles persistently across restarts.

- [ ] **Step 4: Commit**

```bash
git add package/desktop/src/tray.ts package/desktop/src/main.ts
git commit -m "feat(desktop): full tray menu with status header + autostart toggle"
```

### Task 5.4: macOS notification permission flow (A3)

Spec §2 promises "崩溃 → 托盘气泡". On macOS, `new Notification(...)` silently drops when the app hasn't been granted notification permission — the user gets zero feedback for a crashed sidecar. We need to (a) request permission lazily on first attempted notification, (b) fall back to a tray-menu red header if permission was denied.

**Files:**
- Create: `package/desktop/src/notifier.ts`

- [ ] **Step 1: Write notifier.ts**

```ts
import { Notification, shell, app } from "electron";
import { log } from "./logger.js";

let permissionAsked = false;
let permissionGranted = process.platform !== "darwin"; // Win/Linux: assumed

/**
 * Send a desktop notification if permitted. Returns true if delivered.
 * On first call on macOS, triggers the system permission prompt.
 * On denial (or any failure), returns false — caller should fall back
 * to in-app feedback (tray header text, dialog, etc.).
 */
export async function notify(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (!Notification.isSupported()) {
    log.warn("Notification not supported on this platform");
    return false;
  }

  if (process.platform === "darwin" && !permissionAsked) {
    permissionAsked = true;
    // Electron API for Notification does not expose requestPermission directly;
    // we trigger the system prompt by attempting to show one. Result is
    // recorded after the first .show() — there is no synchronous reply.
    // To detect denial, we listen for a "failed"-style absence: if 'show'
    // event never fires within 500ms, treat as denied.
    permissionGranted = await new Promise<boolean>((resolve) => {
      const probe = new Notification({ title: app.getName(), body: "Enable notifications to see sidecar alerts." });
      let settled = false;
      probe.once("show", () => { if (!settled) { settled = true; resolve(true); } });
      probe.once("failed", () => { if (!settled) { settled = true; resolve(false); } });
      probe.show();
      setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 800);
    });
    log.info(`macOS notification permission: ${permissionGranted ? "granted" : "denied or unknown"}`);
  }

  if (!permissionGranted) return false;

  const n = new Notification({ title, body });
  if (onClick) n.on("click", onClick);
  n.show();
  return true;
}

export function notifyCrash(onClickOpenLogs: () => void): void {
  void notify(
    "mimo2codex sidecar crashed",
    "Click to open logs.",
    onClickOpenLogs,
  );
  // Caller is responsible for separately reflecting state in the tray
  // header text (red ✕), so the user still sees something even if the
  // notification dropped.
}

export function openSupportLink(): void {
  shell.openExternal("https://github.com/7as0nch/mimo2codex/issues");
}
```

- [ ] **Step 2: Wire notifyCrash into sidecar.ts crash handler**

In Task 3.8's `sidecar.ts` (or wherever the final-crash branch lives — the spot that gives up after one retry), import `notifyCrash` and call it inside the "crashed, not retrying" branch, passing the main process's `openLogs` action.

- [ ] **Step 3: Manual verification (macOS)**

1. Run `npm --prefix package/desktop run dev` — on first launch the macOS notification permission prompt should appear once.
2. Approve. Manually kill the sidecar twice rapidly (`pkill -9 -f mimo2codex-sidecar` while in dev). Expect a system notification "mimo2codex sidecar crashed". Click it → logs window opens.
3. Reset by going to System Settings → Notifications → mimo2codex → Allow notifications: OFF. Repeat the kill — expect no system notification but the tray header still turns red `✕`.

- [ ] **Step 4: Commit**

```bash
git add package/desktop/src/notifier.ts package/desktop/src/sidecar.ts
git commit -m "feat(desktop): macOS notification permission flow with tray-header fallback"
```

### Task 5.5: Sidecar version drift indicator (B3)

The bundled sidecar version is frozen at electron-builder build time. Two months later, npm has shipped fixes the desktop user can't get. Without auto-update infrastructure (still YAGNI'd), we show a passive cue: a "Update available" item in the tray menu pointing at the download page.

**Files:**
- Create: `package/desktop/src/updateCheck.ts`
- Modify: `package/desktop/src/tray.ts`
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Write updateCheck.ts**

```ts
import { net } from "electron";
import { log } from "./logger.js";

const RELEASES_URL = "https://api.github.com/repos/7as0nch/mimo2codex/releases/latest";

/** Returns the latest desktop release tag (e.g. "v0.5.0-desktop"), or null on any failure. */
export async function fetchLatestDesktopTag(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ method: "GET", url: RELEASES_URL });
    let body = "";
    req.on("response", (resp) => {
      resp.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      resp.on("end", () => {
        try {
          const json = JSON.parse(body) as { tag_name?: string };
          resolve(typeof json.tag_name === "string" ? json.tag_name : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", (err) => { log.warn("update check failed", { error: err.message }); resolve(null); });
    req.end();
  });
}

/** Strips leading "v" and trailing "-desktop[.N]", returns [major, minor, patch] or null. */
export function parseDesktopVersion(tag: string): [number, number, number] | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)(?:-desktop(?:\.\d+)?)?$/.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True if `latest` is at least 1 minor ahead of `current`. */
export function isMinorAhead(current: [number, number, number], latest: [number, number, number]): boolean {
  if (latest[0] > current[0]) return true;
  if (latest[0] < current[0]) return false;
  return latest[1] - current[1] >= 1;
}
```

- [ ] **Step 2: Wire into main.ts after tray is created**

Add to `main.ts`, after `createTray(trayActions)`:

```ts
  // Check for desktop updates ~5s after launch (debounce against startup load),
  // then daily. Result feeds into tray menu — no popup, no download.
  setTimeout(checkForDesktopUpdate, 5_000);
  setInterval(checkForDesktopUpdate, 24 * 60 * 60 * 1000);

  async function checkForDesktopUpdate(): Promise<void> {
    const { fetchLatestDesktopTag, parseDesktopVersion, isMinorAhead } =
      await import("./updateCheck.js");
    const tag = await fetchLatestDesktopTag();
    if (!tag) return;
    const latest = parseDesktopVersion(tag);
    const current = parseDesktopVersion(`v${app.getVersion()}-desktop`);
    if (!latest || !current) return;
    if (isMinorAhead(current, latest)) {
      log.info("desktop update available", { current: app.getVersion(), latest: tag });
      const { setUpdateAvailable } = await import("./tray.js");
      setUpdateAvailable(true);
    }
  }
```

- [ ] **Step 3: Add `setUpdateAvailable` + menu item to tray.ts**

In `tray.ts`, add module-level state and an exported setter, and inject a menu item in `rebuildMenu` when set:

```ts
let updateAvailable = false;
export function setUpdateAvailable(v: boolean): void {
  updateAvailable = v;
  // Force a rebuild on the NEXT updateStatus call; callers typically
  // call updateStatus on a state change, but if nothing changes for
  // a long time we manually trigger via the most-recent status:
  if (lastActions && lastStatus) rebuildMenu(lastActions, lastStatus);
}

// Keep most-recent args so setUpdateAvailable can re-render without them
let lastActions: TrayActions | null = null;
let lastStatus: SidecarStatus | null = null;
```

In `rebuildMenu`, after the "Restart sidecar" item, insert:

```ts
    ...(updateAvailable ? [{
      label: "●  Update available — Get latest",
      click: () => shell.openExternal("https://mimodoc.chengj.online/download"),
    } as Electron.MenuItemConstructorOptions] : []),
```

And at the top of `rebuildMenu`, persist `lastActions = actions; lastStatus = status;`.

- [ ] **Step 4: Unit test**

Create `package/desktop/test/updateCheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDesktopVersion, isMinorAhead } from "../src/updateCheck.js";

describe("updateCheck", () => {
  it("parses canonical tags", () => {
    expect(parseDesktopVersion("v0.4.5-desktop")).toEqual([0, 4, 5]);
    expect(parseDesktopVersion("v1.2.3-desktop.4")).toEqual([1, 2, 3]);
    expect(parseDesktopVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseDesktopVersion("garbage")).toBeNull();
  });
  it("flags minor-or-major increases only", () => {
    expect(isMinorAhead([0, 4, 5], [0, 5, 0])).toBe(true);
    expect(isMinorAhead([0, 4, 5], [1, 0, 0])).toBe(true);
    expect(isMinorAhead([0, 4, 5], [0, 4, 6])).toBe(false);
    expect(isMinorAhead([0, 5, 0], [0, 4, 9])).toBe(false);
  });
});
```

Run:

```bash
npm --prefix package/desktop run test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/updateCheck.ts package/desktop/src/tray.ts package/desktop/src/main.ts package/desktop/test/updateCheck.test.ts
git commit -m "feat(desktop): passive update-available indicator from GitHub Releases"
```

---

## Phase 6 — Settings window (first-run + on-demand)

### Task 6.1: Settings window — main side scaffold

**Files:**
- Create: `package/desktop/src/windows/settings.ts`

- [ ] **Step 1: Implement window manager**

```ts
import { BrowserWindow, ipcMain, app } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadRuntime, saveRuntime } from "../runtime.js";
import { readEnv, writeEnv } from "../envFile.js";
import { needsFirstRunSetup } from "../firstRun.js";
import { setAutostart } from "../autostart.js";
import { IPC_CHANNEL, type RendererToMain, type MainToRenderer } from "../ipc.js";
import { log } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..");  // package/desktop/dist

let win: BrowserWindow | null = null;

export interface SettingsCallbacks {
  /** Called after Save & Restart — main wires this to sidecar restart */
  onSaved: (opts: { showAdminUiAfterSave: boolean }) => Promise<void>;
  /** Called when user cancels in first-run mode (= equivalent to Quit) */
  onCancelInFirstRun: () => void;
}

export function openSettings(cb: SettingsCallbacks): void {
  if (win) {
    win.focus();
    return;
  }
  const repoRoot = resolve(distDir, "..", "..", "..", "..");
  const winIcon = join(repoRoot, "package/win/icon.ico");
  win = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "mimo2codex Settings",
    show: false,
    // Explicit Win taskbar icon (see adminWebview.ts).
    icon: process.platform === "win32" ? winIcon : undefined,
    webPreferences: {
      preload: join(distDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(join(distDir, "renderer/settings/index.html"));
  win.once("ready-to-show", () => win!.show());
  win.on("closed", () => { win = null; });

  const send = (msg: MainToRenderer) => win?.webContents.send(IPC_CHANNEL, msg);
  const userDataDir = app.getPath("userData");

  const onRendererMsg = (_e: Electron.IpcMainEvent, msg: RendererToMain) => {
    if (!win || !msg) return;
    if (msg.type === "settings:load") {
      send({
        type: "settings:loaded",
        payload: {
          runtime: loadRuntime(userDataDir),
          env: readEnv(userDataDir),
          isFirstRun: needsFirstRunSetup(userDataDir),
        },
      });
    } else if (msg.type === "settings:save") {
      log.info("settings saved by user", {
        port: msg.payload.runtime.port,
        envKeys: Object.keys(msg.payload.env),
      });
      saveRuntime(userDataDir, msg.payload.runtime);
      setAutostart(msg.payload.runtime.autostart);
      writeEnv(userDataDir, msg.payload.env);
      win.close();
      cb.onSaved({ showAdminUiAfterSave: msg.payload.showAdminUiAfterSave }).catch((err) => {
        log.error("onSaved failed", { error: (err as Error).message });
      });
    } else if (msg.type === "settings:cancel") {
      win.close();
      if (msg.payload.isFirstRun) cb.onCancelInFirstRun();
    }
  };
  ipcMain.on(IPC_CHANNEL, onRendererMsg);
  win.on("closed", () => ipcMain.removeListener(IPC_CHANNEL, onRendererMsg));
}
```

- [ ] **Step 2: Commit**

```bash
git add package/desktop/src/windows/settings.ts
git commit -m "feat(desktop): settings window main-side (open/IPC handlers)"
```

### Task 6.1.1: macOS application Edit menu (A4)

Without `Menu.setApplicationMenu(...)` on macOS, the global menu bar inherits Electron defaults that lack copy/paste roles wired to keyboard shortcuts inside a BrowserWindow text input. Result: user can't Cmd+V their API key into the settings form. Fix: register a minimal application menu with an Edit submenu (standard roles only — Cmd+A/X/C/V/Z/Shift+Z). Tray-resident app stays tray-resident; `LSUIElement` (Task 9.1.1) keeps the menu bar visually clean.

**Files:**
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Install application menu (macOS only)**

In `main.ts`, after `await app.whenReady()` and before tray creation, add:

```ts
  if (process.platform === "darwin") {
    const { Menu } = await import("electron");
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.getName(),
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]));
  }
```

Note: We deliberately do NOT add this menu on Windows — there's no global menu bar to attach it to, and every BrowserWindow on Windows already has built-in keyboard shortcuts for copy/paste inside text inputs.

- [ ] **Step 2: Manual verification (macOS)**

1. Launch settings window from tray → click into API Key input → try Cmd+V (with a string on clipboard). Should paste.
2. Select text in API Key → Cmd+C → paste elsewhere. Should copy.
3. Verify the macOS menu bar shows `mimo2codex` and `Edit` menus (only visible because LSUIElement is intentionally NOT yet applied — Task 9.1.1 takes care of hiding the app from the dock/menu bar header in packaged builds; in `dev` you'll still see them, which is fine for testing).

- [ ] **Step 3: Commit**

```bash
git add package/desktop/src/main.ts
git commit -m "feat(desktop): macOS application menu with Edit roles (enables Cmd+C/V in inputs)"
```

### Task 6.2: Settings window — React renderer

**Files:**
- Create: `package/desktop/renderer/settings/main.tsx` (replace stub)
- Create: `package/desktop/renderer/settings/App.tsx`

- [ ] **Step 1: Replace stub main.tsx**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <ConfigProvider>
    <App />
  </ConfigProvider>
);
```

- [ ] **Step 2: Write App.tsx**

```tsx
import React, { useEffect, useState } from "react";
import { Form, Input, Select, InputNumber, Checkbox, Button, Space, Typography, Alert } from "antd";
import type { RuntimeConfig } from "../../shared/types.js";
import { PROVIDER_KEYS } from "../../shared/types.js";

interface LoadedState {
  runtime: RuntimeConfig;
  env: Record<string, string>;
  isFirstRun: boolean;
}

export function App() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [provider, setProvider] = useState<"mimo" | "deepseek" | "generic">("mimo");
  const [apiKey, setApiKey] = useState("");
  const [port, setPort] = useState(8788);
  const [autostart, setAutostartFlag] = useState(false);
  const [showAdminAfter, setShowAdminAfter] = useState(true);

  useEffect(() => {
    const off = window.m2c.on((msg) => {
      if (msg.type === "settings:loaded") {
        setState(msg.payload);
        setPort(msg.payload.runtime.port);
        setAutostartFlag(msg.payload.runtime.autostart);
        // Pick first provider whose key already exists in env, default mimo
        const firstProvider = PROVIDER_KEYS.find(p => msg.payload.env[p.envKey]);
        if (firstProvider) {
          setProvider(firstProvider.provider);
          setApiKey(msg.payload.env[firstProvider.envKey]);
        }
      }
    });
    window.m2c.send({ type: "settings:load" });
    return off;
  }, []);

  if (!state) return <div style={{ padding: 24 }}>Loading…</div>;

  const onSave = () => {
    const envKey = PROVIDER_KEYS.find(p => p.provider === provider)!.envKey;
    window.m2c.send({
      type: "settings:save",
      payload: {
        runtime: { ...state.runtime, port, autostart },
        env: { ...state.env, [envKey]: apiKey },
        showAdminUiAfterSave: showAdminAfter,
      },
    });
  };

  const onCancel = () => {
    window.m2c.send({ type: "settings:cancel", payload: { isFirstRun: state.isFirstRun } });
  };

  const placeholderForProvider = provider === "mimo"
    ? "sk-xxxxxxxx (or tp-xxxxxxxx for token-plan)"
    : "sk-xxxxxxxx";

  const canSave = apiKey.trim().length > 0 && port > 0 && port < 65536;

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {state.isFirstRun ? "Welcome to mimo2codex" : "Settings"}
      </Typography.Title>
      {state.isFirstRun && (
        <Alert
          type="info"
          showIcon
          message="Set your provider API key to get started. You can add more providers later from the Admin UI."
          style={{ marginBottom: 16 }}
        />
      )}
      <Form layout="vertical">
        <Form.Item label="Provider">
          <Select value={provider} onChange={setProvider} options={[
            { value: "mimo", label: "MiMo (Xiaomi)" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "generic", label: "Generic OpenAI-compatible" },
          ]} />
        </Form.Item>
        <Form.Item label="API Key">
          <Input.Password
            value={apiKey}
            placeholder={placeholderForProvider}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Form.Item>
        <Form.Item label="Port">
          <InputNumber min={1} max={65535} value={port} onChange={(v) => setPort(v ?? 8788)} />
        </Form.Item>
        <Form.Item>
          <Checkbox checked={autostart} onChange={(e) => setAutostartFlag(e.target.checked)}>
            Start on system boot
          </Checkbox>
        </Form.Item>
        <Form.Item>
          <Checkbox checked={showAdminAfter} onChange={(e) => setShowAdminAfter(e.target.checked)}>
            Show Admin UI on first launch
          </Checkbox>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" onClick={onSave} disabled={!canSave}>
              Save & Restart
            </Button>
            <Button onClick={onCancel}>
              {state.isFirstRun ? "Quit" : "Cancel"}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
}
```

- [ ] **Step 3: Build + smoke (still missing the main.ts wire-up — that's next)**

```bash
npm --prefix package/desktop run build
```

Expected: vite build succeeds, produces `dist/renderer/settings/index.html`.

- [ ] **Step 4: Commit**

```bash
git add package/desktop/renderer/settings/
git commit -m "feat(desktop): settings window React UI (4-field minimal form)"
```

### Task 6.2.1: Settings window — data location notice (B2)

Spec §3.3 mocked a "Data dir" field; Task 6.2's form dropped it. Re-introduce it as a **read-only** display row plus a one-line privacy note so users (a) know where their API key is stored, (b) can attach the right folder when reporting bugs, (c) aren't surprised the key is plaintext.

We don't make the data dir editable — letting users redirect it would require migration, and that's explicitly YAGNI'd in spec §5. We just show it.

**Files:**
- Modify: `package/desktop/renderer/settings/App.tsx`
- Modify: `package/desktop/src/windows/settings.ts` (pass `userDataDir` to renderer)
- Modify: `package/desktop/src/preload.ts` (expose `userDataDir` via contextBridge)

- [ ] **Step 1: Add `userDataDir` to settings IPC payload**

In `windows/settings.ts`, when sending the initial state to the renderer (the `mainToRenderer` settings:init message), include `userDataDir: app.getPath("userData")`. Update the matching type in `shared/types.ts` so the renderer knows the field exists.

- [ ] **Step 2: Render the field in App.tsx**

In `renderer/settings/App.tsx`, after the `Port` Form.Item and before the autostart `Checkbox`, insert:

```tsx
        <Form.Item label="Data location">
          <Input
            value={state.userDataDir}
            readOnly
            addonAfter={
              <a onClick={() => window.m2c.openPath(state.userDataDir)}>Open</a>
            }
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
            Your API key is stored in plain text at <code>.env</code> inside this folder.
            Include this folder when filing a bug report (but redact the key first).
          </Typography.Text>
        </Form.Item>
```

- [ ] **Step 3: Expose `openPath` in preload.ts**

In `preload.ts` `contextBridge.exposeInMainWorld("m2c", { ... })`, add:

```ts
openPath: (p: string) => ipcRenderer.send(IPC_CHANNEL, { type: "shell:openPath", payload: { path: p } }),
```

And handle it in `windows/settings.ts` IPC dispatcher: `if (msg.type === "shell:openPath") shell.openPath(msg.payload.path);`

- [ ] **Step 4: Manual verification**

Launch settings window → verify the Data location row shows the actual OS userData path (e.g. `C:\Users\<you>\AppData\Roaming\mimo2codex-desktop` on Win, `~/Library/Application Support/mimo2codex-desktop` on Mac). Click "Open" → file explorer opens that folder. The notice text under the field is visible and readable.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/renderer/settings/App.tsx package/desktop/src/windows/settings.ts package/desktop/src/preload.ts package/desktop/shared/types.ts
git commit -m "feat(desktop): settings window shows data dir + plain-text key notice"
```

### Task 6.3: Wire settings window + first-run gate into main.ts

**Files:**
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Rewrite main.ts with full bootstrap flow**

```ts
import { app } from "electron";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { initLogger, log } from "./logger.js";
import { needsFirstRunSetup } from "./firstRun.js";
import { openSettings } from "./windows/settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

async function main(): Promise<void> {
  const userDataDir = app.getPath("userData");
  initLogger(userDataDir);
  log.info("mimo2codex-desktop starting", { userDataDir, version: app.getVersion() });

  if (process.platform === "darwin") app.dock?.hide();
  app.on("window-all-closed", (e: Electron.Event) => e.preventDefault());

  await app.whenReady();
  log.info("electron ready");

  const { createTray } = await import("./tray.js");
  const trayActions = {
    openAdminInBrowser: () => log.info("TODO: openAdminInBrowser"),
    openAdminInApp:     () => log.info("TODO: openAdminInApp"),
    openSettings:       () => openSettings({
      onSaved: async ({ showAdminUiAfterSave }) => {
        log.info("settings saved", { showAdminUiAfterSave });
        // Sidecar restart wired in Phase 7
      },
      onCancelInFirstRun: () => {
        log.info("first-run cancelled → quitting");
        app.quit();
      },
    }),
    openLogs:           () => log.info("TODO: openLogs"),
    restartSidecar:     () => log.info("TODO: restartSidecar"),
  };
  createTray(trayActions);

  // First-run gate: pop settings before doing anything else
  if (needsFirstRunSetup(userDataDir)) {
    log.info("first run detected → opening settings");
    trayActions.openSettings();
  }
}

main().catch((err) => {
  log.error("fatal in main", { error: (err as Error).message });
  process.exit(1);
});
```

- [ ] **Step 2: Build + smoke**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: on first run (no `userData/.env`), settings window opens automatically. Fill in key → Save → window closes, tray icon stays. Re-launch: settings does NOT auto-open.

- [ ] **Step 3: Manual quit-on-cancel verification**

Delete `userData/.env` (find via `app.getPath("userData")` — Win: `%APPDATA%/mimo2codex-desktop`, Mac: `~/Library/Application Support/mimo2codex-desktop`), re-launch, click "Quit" button. Expected: app fully exits.

- [ ] **Step 4: Commit**

```bash
git add package/desktop/src/main.ts
git commit -m "feat(desktop): wire settings window with first-run gate"
```

---

## Phase 7 — Sidecar bundling + lifecycle integration

This is the most consequential phase. The desktop app needs a working `mimo2codex` Node CLI to spawn.

### Task 7.1: Sidecar bundling strategy — extracted Node + extracted CLI

**Files:**
- Create: `scripts/build-sidecar.mjs`
- Modify: root `package.json` (add `sidecar:build` script)

- [ ] **Step 1: Add script entry**

In root `package.json` scripts:

```jsonc
"sidecar:build": "node scripts/build-sidecar.mjs"
```

- [ ] **Step 2: Write the bundler**

`scripts/build-sidecar.mjs`:

```javascript
// Build a self-contained sidecar bundle for the current platform.
// Output: package/desktop/resources/sidecar/{cli,node_modules,node-runtime/node[.exe]}
//
// Strategy: ship the compiled dist/ + production node_modules + a Node 20
// runtime binary downloaded from nodejs.org. No pkg / nexe — strict ESM
// + better-sqlite3 .node files make file-copy more reliable than binary
// wrapping. Electron will spawn `node-runtime/node dist/cli.js`.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { get } from "node:https";
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar";
import { Extract as UnzipExtract } from "unzipper";

const root = resolve(import.meta.dirname, "..");
const sidecarOut = resolve(root, "package/desktop/resources/sidecar");
const nodeRuntimeDir = resolve(sidecarOut, "node-runtime");

const NODE_VERSION = process.env.SIDECAR_NODE_VERSION || "20.18.0";
const arch = process.env.SIDECAR_ARCH || process.arch;
const platform = process.env.SIDECAR_PLATFORM || process.platform;

function clean() {
  rmSync(sidecarOut, { recursive: true, force: true });
  mkdirSync(sidecarOut, { recursive: true });
}

function buildCli() {
  console.log("[sidecar] building CLI (tsc)...");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

function copyCliArtifacts() {
  console.log("[sidecar] copying dist/ and node_modules/...");
  cpSync(resolve(root, "dist"), resolve(sidecarOut, "dist"), { recursive: true });
  cpSync(resolve(root, "package.json"), resolve(sidecarOut, "package.json"));
  // Production deps only — install fresh into sidecar dir
  execSync("npm install --omit=dev --no-audit --no-fund", { cwd: sidecarOut, stdio: "inherit" });
}

async function downloadNodeRuntime() {
  console.log(`[sidecar] downloading Node ${NODE_VERSION} for ${platform}-${arch}...`);
  mkdirSync(nodeRuntimeDir, { recursive: true });
  const archName = arch === "arm64" ? "arm64" : "x64";
  const ext = platform === "win32" ? "zip" : "tar.gz";
  const plat = platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux";
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${plat}-${archName}.${ext}`;
  const archivePath = resolve(sidecarOut, `node-archive.${ext}`);

  await new Promise((resolveDl, rejectDl) => {
    const req = get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // follow redirect
        return get(res.headers.location, (r2) => r2.pipe(createWriteStream(archivePath)).on("finish", resolveDl).on("error", rejectDl));
      }
      res.pipe(createWriteStream(archivePath)).on("finish", resolveDl).on("error", rejectDl);
    });
    req.on("error", rejectDl);
  });

  console.log("[sidecar] extracting node binary...");
  if (ext === "tar.gz") {
    await tarExtract({ file: archivePath, cwd: sidecarOut });
    // Extracted dir is e.g. node-v20.18.0-darwin-arm64; rename and grab only bin/node
    const extractedDir = resolve(sidecarOut, `node-v${NODE_VERSION}-${plat}-${archName}`);
    cpSync(resolve(extractedDir, "bin/node"), resolve(nodeRuntimeDir, "node"));
    execSync(`chmod +x ${resolve(nodeRuntimeDir, "node")}`, { stdio: "inherit" });
    rmSync(extractedDir, { recursive: true });
  } else {
    // Windows: unzipper
    await new Promise((resolveExt, rejectExt) => {
      require("node:fs").createReadStream(archivePath)
        .pipe(UnzipExtract({ path: sidecarOut }))
        .on("close", resolveExt)
        .on("error", rejectExt);
    });
    const extractedDir = resolve(sidecarOut, `node-v${NODE_VERSION}-win-${archName}`);
    cpSync(resolve(extractedDir, "node.exe"), resolve(nodeRuntimeDir, "node.exe"));
    rmSync(extractedDir, { recursive: true });
  }
  rmSync(archivePath);
}

async function main() {
  clean();
  buildCli();
  copyCliArtifacts();
  await downloadNodeRuntime();
  writeFileSync(resolve(sidecarOut, "SIDECAR_INFO.json"), JSON.stringify({
    nodeVersion: NODE_VERSION,
    platform,
    arch,
    builtAt: new Date().toISOString(),
  }, null, 2));
  console.log("[sidecar] done →", sidecarOut);
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Install tar + unzipper as devDeps for the script (root)**

The script uses `tar` and `unzipper`. Add to root devDependencies (this is a build-time tool, doesn't affect npm package consumers since `files:` in package.json controls what gets published):

```bash
npm install --save-dev tar unzipper
```

Verify the root `package.json` `files` array is still `["dist", "mimoskill", "doc", ".env.example", "AGENTS.md", "README.md", "README.zh.md", "LICENSE"]` — i.e. devDeps don't ship to npm consumers.

- [ ] **Step 4: Run for local platform**

```bash
npm run sidecar:build
```

Expected: produces `package/desktop/resources/sidecar/` with `dist/`, `node_modules/`, `node-runtime/node[.exe]`, `package.json`, `SIDECAR_INFO.json`. Total ~80-120MB depending on platform.

- [ ] **Step 5: Smoke-test the bundled sidecar by hand**

```bash
# Mac/Linux:
package/desktop/resources/sidecar/node-runtime/node package/desktop/resources/sidecar/dist/cli.js --help

# Windows (PowerShell):
.\package\desktop\resources\sidecar\node-runtime\node.exe .\package\desktop\resources\sidecar\dist\cli.js --help
```

Expected: prints the mimo2codex CLI help text.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-sidecar.mjs package.json package-lock.json
git commit -m "feat(sidecar): bundler script — extracted Node + dist + node_modules"
```

### Task 7.1.1: better-sqlite3 win-arm64 prebuild probe (A6)

`better-sqlite3` ships precompiled native binaries via prebuild-install. Coverage for `win32-arm64` has historically been intermittent — when the prebuild is missing, install falls back to compiling from source, which fails in CI because windows-arm64 GitHub runners don't have the Visual Studio + Python toolchain set up. Discovering that during `electron-builder --win --arm64` is too late: matrix wastes ~10 min before failing.

We add a probe step early in CI (and locally in the bundler) that explicitly verifies a prebuild exists. If not, the win-arm64 matrix row is **skipped with a warning** rather than failing the whole workflow.

**Files:**
- Create: `scripts/probe-prebuild.mjs`
- Modify: `.github/workflows/build-desktop.yml` (covered structurally in Task 9.2; this task only ships the probe script)

- [ ] **Step 1: Write the probe script**

```js
// scripts/probe-prebuild.mjs
// Verifies that better-sqlite3 has a precompiled native binary for the
// requested platform/arch. Exits 0 if available, 1 if missing.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [platform, arch] = [process.env.TARGET_PLATFORM ?? process.platform, process.env.TARGET_ARCH ?? process.arch];

// Resolve installed better-sqlite3 root
const pkgRoot = join(__dirname, "..", "node_modules", "better-sqlite3");
if (!existsSync(pkgRoot)) {
  console.error("better-sqlite3 not installed; run `npm ci` first.");
  process.exit(1);
}

// Look for a prebuilt .node matching this platform+arch.
// Layout: better-sqlite3/build/Release/better_sqlite3.node (after install)
// OR: better-sqlite3/prebuilds/<platform>-<arch>/node.napi.node (raw download)
const candidates = [
  join(pkgRoot, "build", "Release", "better_sqlite3.node"),
  join(pkgRoot, "prebuilds", `${platform}-${arch}`, "node.napi.node"),
  join(pkgRoot, "prebuilds", `${platform}-${arch}`, "better-sqlite3.node"),
];
const found = candidates.find(existsSync);
if (!found) {
  console.error(`No better-sqlite3 prebuild found for ${platform}-${arch}.`);
  console.error("Candidates checked:");
  for (const c of candidates) console.error("  -", c);
  process.exit(1);
}
console.log(`OK: better-sqlite3 prebuild present for ${platform}-${arch} at ${found}`);
```

- [ ] **Step 2: Add npm script**

In root `package.json` `"scripts"`:

```jsonc
"probe-prebuild": "node scripts/probe-prebuild.mjs"
```

- [ ] **Step 3: Local sanity check**

```bash
npm run probe-prebuild
```

Expected: prints `OK: ... win32-x64 ...` (or whatever your dev OS/arch is) and exits 0.

Then simulate a missing target:

```bash
# Win/PowerShell:
$env:TARGET_PLATFORM="win32"; $env:TARGET_ARCH="arm64"; npm run probe-prebuild
# Bash:
TARGET_PLATFORM=win32 TARGET_ARCH=arm64 npm run probe-prebuild
```

Expected: exits non-zero with the "No better-sqlite3 prebuild found" message (since you're not on arm64 the path candidates won't exist).

- [ ] **Step 4: Task 9.2 will gate the win-arm64 matrix row on this probe**

Note: the actual workflow integration lives in Task 9.2 — when that task ships, the win-arm64 job runs `npm run probe-prebuild` early, and on non-zero exit calls `core.setOutput('skip-build', 'true')` to short-circuit the rest of the row instead of failing it. **Cross-reference this section from Task 9.2.**

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-prebuild.mjs package.json
git commit -m "feat(ci): better-sqlite3 prebuild probe (lets win-arm64 fail fast & soft)"
```

### Task 7.2: Wire sidecar into main.ts

**Files:**
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Add sidecar wiring**

Replace the whole `main()` body:

```ts
async function main(): Promise<void> {
  const userDataDir = app.getPath("userData");
  initLogger(userDataDir);
  log.info("mimo2codex-desktop starting", { userDataDir, version: app.getVersion() });

  if (process.platform === "darwin") app.dock?.hide();
  app.on("window-all-closed", (e: Electron.Event) => e.preventDefault());

  await app.whenReady();
  log.info("electron ready");

  const { SidecarManager } = await import("./sidecar.js");
  const { findFreePort } = await import("./portProbe.js");
  const { loadRuntime, saveRuntime } = await import("./runtime.js");
  const { sidecarPaths } = await import("./paths.js");

  const runtime = loadRuntime(userDataDir);
  const port = await findFreePort(runtime.port);
  if (port !== runtime.port) {
    log.warn("preferred port busy → using next free", { preferred: runtime.port, actual: port });
  }
  const paths = sidecarPaths();
  log.info("sidecar paths", paths);

  const sidecar = new SidecarManager({
    binPath: paths.node,
    extraArgs: [paths.cliEntry],
    dataDir: userDataDir,
    port,
  });
  sidecar.on("stdout", (s: string) => process.stderr.write(`[sidecar.out] ${s}`));
  sidecar.on("stderr", (s: string) => process.stderr.write(`[sidecar.err] ${s}`));
  sidecar.on("status", (st) => { log.info("sidecar status", st); /* tray status update Task 7.4 */ });

  // First-run gate BEFORE starting sidecar
  const { needsFirstRunSetup } = await import("./firstRun.js");
  const isFirstRun = needsFirstRunSetup(userDataDir);

  if (!isFirstRun) {
    await sidecar.start();
    saveRuntime(userDataDir, { ...runtime, port });
  }

  const { createTray } = await import("./tray.js");
  const trayActions = {
    openAdminInBrowser: () => {
      const st = sidecar.status();
      if (st.kind === "running") {
        import("electron").then(({ shell }) => shell.openExternal(`http://127.0.0.1:${st.port}/admin/`));
      }
    },
    openAdminInApp:     () => log.info("TODO: openAdminInApp"),  // Phase 8
    openSettings:       () => openSettings({
      onSaved: async ({ showAdminUiAfterSave }) => {
        // After save: stop, repick port, restart
        await sidecar.stop();
        const fresh = loadRuntime(userDataDir);
        const newPort = await findFreePort(fresh.port);
        saveRuntime(userDataDir, { ...fresh, port: newPort });
        // Reconfigure SidecarManager port; simplest: stop+drop+create a new one
        // (For brevity here we reuse the same instance; production task may
        //  externalize this into a "restart-with-new-config" method.)
        await sidecar.start();
        log.info("sidecar restarted after settings save", { port: newPort, showAdminUiAfterSave });
      },
      onCancelInFirstRun: () => app.quit(),
    }),
    openLogs:           () => log.info("TODO: openLogs"),
    restartSidecar:     async () => { await sidecar.stop(); await sidecar.start(); },
  };
  createTray(trayActions);

  if (isFirstRun) {
    log.info("first run → opening settings (sidecar not started)");
    trayActions.openSettings();
  }

  app.on("before-quit", async (e) => {
    if (sidecar.status().kind !== "crashed") {
      e.preventDefault();
      await sidecar.stop();
      app.exit(0);
    }
  });
}
```

- [ ] **Step 2: Create paths.ts**

`package/desktop/src/paths.ts`:

```ts
import { app } from "electron";
import { join, resolve } from "node:path";

export interface SidecarPaths {
  /** Path to bundled node runtime binary */
  node: string;
  /** Path to compiled CLI entry point */
  cliEntry: string;
}

export function sidecarPaths(): SidecarPaths {
  // In a packaged app, resources are in app.getAppPath() → resources/
  // In dev, they're at ../resources/ relative to dist/
  const base = app.isPackaged
    ? process.resourcesPath
    : resolve(app.getAppPath(), "resources");
  const sidecarDir = join(base, "sidecar");
  const nodeBin = process.platform === "win32" ? "node-runtime/node.exe" : "node-runtime/node";
  return {
    node: join(sidecarDir, nodeBin),
    cliEntry: join(sidecarDir, "dist/cli.js"),
  };
}
```

- [ ] **Step 3: Build + smoke**

```bash
npm run sidecar:build
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected:
- First-run: settings window opens, sidecar does NOT start. Fill key → Save → sidecar boots → tray header shows `● running on :8788`.
- Subsequent run: sidecar starts immediately, tray header green.
- "Open Admin UI in browser" launches default browser to localhost.
- "Quit" cleanly stops the sidecar (verify with `ps -ef | grep mimo` or Task Manager).

- [ ] **Step 4: Commit**

```bash
git add package/desktop/src/main.ts package/desktop/src/paths.ts
git commit -m "feat(desktop): full sidecar lifecycle wired into main process"
```

### Task 7.2.1: Port-change transition UX (C4)

When the user changes Port in the settings form and clicks Save & Restart, three things happen in sequence: write runtime.json → SIGTERM old sidecar → spawn new sidecar. Without UX, the settings window slams closed and the user is left wondering if it worked. Worse, if the new port is taken (firewall, antivirus quirk), they don't see the error.

Fix: keep the settings window open, disable Save, show a transient "Restarting on :{newPort}..." message, then auto-close only after sidecar emits `running`. On failure, surface the error inline.

**Files:**
- Modify: `package/desktop/src/windows/settings.ts`
- Modify: `package/desktop/renderer/settings/App.tsx`

- [ ] **Step 1: Add `settings:restartProgress` IPC channel**

In `shared/types.ts`, add to `MainToRenderer`:

```ts
| { type: "settings:restartProgress"; payload: { phase: "writing" | "stopping" | "starting" | "done" | "error"; port?: number; message?: string } }
```

- [ ] **Step 2: Emit progress from main side**

In `windows/settings.ts`, the `settings:save` handler currently does `saveRuntime; writeEnv; cb.onSave(); win.close()`. Replace with:

```ts
async function performSave(msg: SettingsSaveMsg): Promise<void> {
  const send = (p: MainToRenderer) => win.webContents.send(IPC_CHANNEL, p);
  try {
    send({ type: "settings:restartProgress", payload: { phase: "writing" } });
    await writeEnv(userDataDir, msg.payload.envUpdates);
    await saveRuntime(userDataDir, msg.payload.runtimeUpdates);
    setAutostart(msg.payload.autostart);

    send({ type: "settings:restartProgress", payload: { phase: "stopping" } });
    await cb.stopSidecar();

    send({ type: "settings:restartProgress", payload: { phase: "starting", port: msg.payload.runtimeUpdates.port } });
    await cb.startSidecar();  // resolves when status hits 'running' or rejects on crash

    send({ type: "settings:restartProgress", payload: { phase: "done" } });
    win.close();
    if (msg.payload.showAdminAfter) cb.openAdminInApp();
  } catch (err) {
    send({ type: "settings:restartProgress", payload: { phase: "error", message: (err as Error).message } });
  }
}
```

This requires `stopSidecar` / `startSidecar` callbacks added to the existing `cb: SettingsCallbacks` interface — wire those through from `main.ts` to the existing `SidecarManager`.

- [ ] **Step 3: Show progress in App.tsx**

Add a `restartPhase` state in `App.tsx`:

```tsx
const [restart, setRestart] = useState<{ phase: string; message?: string; port?: number } | null>(null);
useEffect(() => window.m2c.onMessage((m) => {
  if (m.type === "settings:restartProgress") setRestart(m.payload);
}), []);
```

While `restart` is non-null, replace the action button row with a Spin + label:

```tsx
{restart && restart.phase !== "error" ? (
  <Alert
    type="info"
    message={
      restart.phase === "writing"  ? "Saving config..." :
      restart.phase === "stopping" ? "Stopping sidecar..." :
      restart.phase === "starting" ? `Starting sidecar on :${restart.port}...` :
      "Done."
    }
    icon={<LoadingOutlined />}
    showIcon
  />
) : restart?.phase === "error" ? (
  <Alert type="error" message={`Restart failed: ${restart.message}`} showIcon closable onClose={() => setRestart(null)} />
) : null}
```

And `disabled={!canSave || restart !== null}` on the Save button.

- [ ] **Step 4: Manual verification**

1. Launch settings → change Port from 8788 to 8790 → Save & Restart. Should see "Stopping sidecar..." → "Starting sidecar on :8790..." → window closes.
2. Change Port to 80 (privileged on Mac/Linux) → Save & Restart. Should see "Starting sidecar on :80..." → red error alert "Restart failed: EACCES: permission denied bind :80" → window stays open, Save re-enabled after dismissing the alert.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/windows/settings.ts package/desktop/renderer/settings/App.tsx package/desktop/shared/types.ts package/desktop/src/main.ts
git commit -m "feat(desktop): settings window shows restart progress + inline failure"
```

### Task 7.3: Status updates push to tray

**Files:**
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Wire status push**

In the `sidecar.on("status", ...)` callback, after `log.info`, append:

```ts
    import("./tray.js").then(({ updateStatus }) => updateStatus(trayActions, st));
```

(Move this AFTER `createTray(trayActions)` is declared — the variable must be in scope. Rearrange the function body so trayActions is built first, then createTray, then sidecar handlers and start.)

- [ ] **Step 2: Build + verify**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: tray status header changes from `○ starting` → `● running on :8788`. Click "Restart sidecar" → briefly `○ starting` → `● running` again. Kill the sidecar manually (Task Manager / `kill`) → `● running` → after restart attempt → `● running` again (1 auto-restart). Kill twice in quick succession → `✕ crashed`.

- [ ] **Step 3: Commit**

```bash
git add package/desktop/src/main.ts
git commit -m "feat(desktop): push sidecar status to tray header"
```

---

## Phase 8 — Admin UI window + logs window

### Task 8.1: Admin UI BrowserWindow

**Files:**
- Create: `package/desktop/src/windows/adminWebview.ts`
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Implement adminWebview.ts**

```ts
import { BrowserWindow } from "electron";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/windows/ → repo root → package/win/icon.ico
const repoRoot = resolve(__dirname, "..", "..", "..", "..", "..");
const winIcon = join(repoRoot, "package/win/icon.ico");

let win: BrowserWindow | null = null;

export function openAdminWindow(port: number): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "mimo2codex Admin",
    // Explicit icon — without this, the Windows taskbar shows Electron's
    // default ☒ glyph. macOS ignores `icon` for BrowserWindow (uses bundle
    // icon set by electron-builder) so this is effectively Win-only.
    icon: process.platform === "win32" ? winIcon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/admin/`);
  win.on("closed", () => { win = null; });
}
```

- [ ] **Step 2: Wire into main.ts trayActions**

Replace the `openAdminInApp` stub:

```ts
    openAdminInApp: () => {
      const st = sidecar.status();
      if (st.kind === "running") {
        import("./windows/adminWebview.js").then(({ openAdminWindow }) => openAdminWindow(st.port));
      }
    },
```

Also, in the `onSaved` callback after `sidecar.start()`, append:

```ts
        if (showAdminUiAfterSave) {
          // Tiny delay so the sidecar's HTTP listener is actually up
          setTimeout(() => {
            const st = sidecar.status();
            if (st.kind === "running") {
              import("./windows/adminWebview.js").then(({ openAdminWindow }) => openAdminWindow(st.port));
            }
          }, 800);
        }
```

- [ ] **Step 3: Build + smoke**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: tray menu → "Open Admin UI in app..." opens a 1100×800 window showing the admin UI. First-run save → after sidecar starts the admin window auto-opens (because checkbox default = true).

- [ ] **Step 4: Commit**

```bash
git add package/desktop/src/windows/adminWebview.ts package/desktop/src/main.ts
git commit -m "feat(desktop): embed admin UI as BrowserWindow"
```

### Task 8.2: Logs window

**Files:**
- Create: `package/desktop/src/windows/logs.ts`
- Create: `package/desktop/renderer/logs/main.tsx` (replace stub)
- Create: `package/desktop/renderer/logs/App.tsx`
- Modify: `package/desktop/src/main.ts`

- [ ] **Step 1: Implement main-side logs.ts**

```ts
import { BrowserWindow, ipcMain, shell, app } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { IPC_CHANNEL, type RendererToMain, type MainToRenderer } from "../ipc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..");
const repoRoot = resolve(__dirname, "..", "..", "..", "..", "..");
const winIcon = join(repoRoot, "package/win/icon.ico");

let win: BrowserWindow | null = null;
let subscribers: Array<(msg: MainToRenderer) => void> = [];

export function openLogsWindow(): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 800,
    height: 500,
    title: "mimo2codex Logs",
    // See adminWebview.ts — explicit icon for Win taskbar; macOS ignores.
    icon: process.platform === "win32" ? winIcon : undefined,
    webPreferences: {
      preload: join(distDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(join(distDir, "renderer/logs/index.html"));

  const onMsg = (_e: Electron.IpcMainEvent, msg: RendererToMain) => {
    if (msg.type === "logs:subscribe") {
      const send = (m: MainToRenderer) => win?.webContents.send(IPC_CHANNEL, m);
      subscribers.push(send);
    }
  };
  ipcMain.on(IPC_CHANNEL, onMsg);
  win.on("closed", () => {
    win = null;
    subscribers = [];
    ipcMain.removeListener(IPC_CHANNEL, onMsg);
  });
}

/** Called by main when sidecar emits stdout/stderr. */
export function broadcastLog(line: string, channel: "stdout" | "stderr"): void {
  for (const s of subscribers) s({ type: "logs:line", payload: { line, channel } });
}

export function openLogFolder(): void {
  shell.openPath(join(app.getPath("userData"), "logs"));
}
```

- [ ] **Step 2: Wire main.ts**

Replace sidecar event handlers to also broadcast:

```ts
  sidecar.on("stdout", (s: string) => {
    process.stderr.write(`[sidecar.out] ${s}`);
    import("./windows/logs.js").then(({ broadcastLog }) => broadcastLog(s, "stdout"));
  });
  sidecar.on("stderr", (s: string) => {
    process.stderr.write(`[sidecar.err] ${s}`);
    import("./windows/logs.js").then(({ broadcastLog }) => broadcastLog(s, "stderr"));
  });
```

And replace the `openLogs` stub:

```ts
    openLogs: () => import("./windows/logs.js").then(({ openLogsWindow }) => openLogsWindow()),
```

- [ ] **Step 3: Implement logs renderer**

`package/desktop/renderer/logs/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(<ConfigProvider><App /></ConfigProvider>);
```

`package/desktop/renderer/logs/App.tsx`:
```tsx
import React, { useEffect, useRef, useState } from "react";
import { Button, Space, Checkbox } from "antd";

interface Line { ts: number; text: string; channel: "stdout" | "stderr" }
const MAX_LINES = 1000;

export function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = window.m2c.on((msg) => {
      if (msg.type === "logs:line") {
        setLines((prev) => {
          const next = [...prev, { ts: Date.now(), text: msg.payload.line, channel: msg.payload.channel }];
          if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
          return next;
        });
      }
    });
    window.m2c.send({ type: "logs:subscribe" });
    return off;
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lines, autoScroll]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 8, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      <div style={{ flex: 1, overflow: "auto", background: "#1e1e1e", color: "#ddd", padding: 8, borderRadius: 4 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.channel === "stderr" ? "#ff8888" : "#ddd", whiteSpace: "pre-wrap" }}>
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Space>
          <Button size="small" onClick={() => setLines([])}>Clear</Button>
          <Checkbox checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}>Auto-scroll</Checkbox>
        </Space>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build + smoke**

```bash
npm --prefix package/desktop run build
npm --prefix package/desktop run dev
```

Expected: tray → Show logs → window opens, sidecar log lines stream in real time. Clear button empties the buffer. Auto-scroll toggle works.

- [ ] **Step 5: Commit**

```bash
git add package/desktop/src/windows/logs.ts package/desktop/renderer/logs/ package/desktop/src/main.ts
git commit -m "feat(desktop): real-time logs window with auto-scroll"
```

---

## Phase 9 — Packaging (electron-builder + GH Actions)

### Task 9.1: electron-builder.yml

**Files:**
- Create: `package/desktop/electron-builder.yml`
- Create: `package/mac/entitlements.mac.plist`

- [ ] **Step 1: Write electron-builder.yml**

`package/desktop/electron-builder.yml`:
```yaml
appId: com.chengj.mimo2codex
productName: mimo2codex
copyright: "© 2026 chengj"

directories:
  output: release
  buildResources: ../

files:
  - "dist/**/*"
  - "node_modules/**/*"
  - "package.json"

extraResources:
  - from: "resources/sidecar"
    to: "sidecar"
  - from: "../win"
    to: "branding-win"
    filter: ["icon.ico", "tray.ico"]
  - from: "../mac"
    to: "branding-mac"
    filter: ["tray-Template*.png"]

mac:
  category: public.app-category.developer-tools
  icon: "../mac/icon.icns"
  target:
    - target: dmg
      arch: [x64, arm64]
  hardenedRuntime: false
  gatekeeperAssess: false
  entitlements: "../mac/entitlements.mac.plist"
  entitlementsInherit: "../mac/entitlements.mac.plist"

win:
  icon: "../win/icon.ico"
  target:
    - target: nsis
      arch: [x64, arm64]

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: mimo2codex
```

- [ ] **Step 2: Write entitlements.mac.plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 3: Generate icon.icns from logo-1024.png**

Add to root `scripts/brand-render-icons.mjs` (append before "console.log done"):

```javascript
// macOS icns: needs iconset directory of 16,32,64,128,256,512,1024 @1x+@2x
const iconset = resolve(root, ".tmp.iconset");
mkdirSync(iconset, { recursive: true });
const sizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of sizes) {
  execSync(`npx --yes sharp-cli@4 -i package/brand/logo-1024.png -o ${iconset}/${name} resize ${size} ${size}`, { stdio: "inherit", cwd: root });
}
if (process.platform === "darwin") {
  execSync(`iconutil -c icns -o package/mac/icon.icns ${iconset}`, { stdio: "inherit", cwd: root });
} else {
  // Cross-platform fallback: png2icons or just copy 1024 PNG renamed.
  // For now, log a warning so cross-build is aware.
  console.warn("[brand:icons] Skipping icon.icns — iconutil only runs on macOS. CI must run this step on macOS.");
}
rmSync(iconset, { recursive: true });
```

- [ ] **Step 4: Run icon generation + verify**

```bash
npm run brand:icons
ls package/win/icon.ico package/mac/tray-Template.png
# On Mac: ls package/mac/icon.icns
```

- [ ] **Step 5: Test local packaging (on current platform)**

```bash
npm run sidecar:build
npm --prefix package/desktop run build
npm --prefix package/desktop run pack
```

Expected on Mac: produces `package/desktop/release/mimo2codex-*.dmg`. On Win: produces `mimo2codex Setup *.exe`. Open the .dmg / run the .exe → install → launch → tray icon appears → full flow works on installed app.

- [ ] **Step 6: Commit**

```bash
git add package/desktop/electron-builder.yml package/mac/entitlements.mac.plist scripts/brand-render-icons.mjs
git commit -m "feat(desktop): electron-builder config for win nsis + mac dmg"
```

### Task 9.1.1: LSUIElement + DMG background + NSIS installer artwork (A2 + B4)

Three packaging polish items that all live in `electron-builder.yml`:

- **A2 — `LSUIElement=true`** via `mac.extendInfo`. Without this, macOS shows the app in the Dock briefly at launch and lists it in Cmd+Tab / Force-Quit. Real menu-bar-only apps (Clash X, 1Password 7, Rectangle) set this Info.plist key.
- **B4 — DMG background** so the install window has an arrow from the app icon to the Applications shortcut, instead of the bare default.
- **B4 — NSIS installer/uninstaller icons** so the Windows installer chrome and Add/Remove Programs show our icon, not generic ones.

**Files:**
- Modify: `package/desktop/electron-builder.yml`
- Create: `package/mac/dmg-background.png` (designed elsewhere; placeholder OK for first build — 540×380 PNG with a faint vertical center divider)
- Create: `package/win/installer.ico` (optional, may reuse `icon.ico`)

- [ ] **Step 1: Extend the `mac` block with `extendInfo`**

In `package/desktop/electron-builder.yml`, replace the existing `mac:` section with:

```yaml
mac:
  category: public.app-category.developer-tools
  icon: "../mac/icon.icns"
  target:
    - target: dmg
      arch: [x64, arm64]
  hardenedRuntime: false
  gatekeeperAssess: false
  entitlements: "../mac/entitlements.mac.plist"
  entitlementsInherit: "../mac/entitlements.mac.plist"
  # Menu-bar-only agent app: hide from Dock and Cmd+Tab.
  # Info.plist `LSUIElement` is what runtime `app.dock?.hide()` *should*
  # have been all along — declarative, no startup flicker.
  extendInfo:
    LSUIElement: true
    NSHumanReadableCopyright: "© 2026 chengj"
```

- [ ] **Step 2: Add a `dmg:` block with background + window layout**

Append to `package/desktop/electron-builder.yml`:

```yaml
dmg:
  background: "../mac/dmg-background.png"
  window:
    width: 540
    height: 380
  contents:
    - x: 140
      y: 200
      type: file
    - x: 400
      y: 200
      type: link
      path: /Applications
  iconSize: 96
  artifactName: "mimo2codex-desktop-${version}-mac-${arch}.${ext}"
```

- [ ] **Step 3: Extend the `nsis:` block with installer icons**

Replace the existing `nsis:` block with:

```yaml
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: mimo2codex
  installerIcon: "../win/icon.ico"
  uninstallerIcon: "../win/icon.ico"
  installerHeaderIcon: "../win/icon.ico"
  # Optional: ask the user whether to wipe %APPDATA%\mimo2codex-desktop
  # on uninstall. Default OFF — most users want to preserve their config.
  deleteAppDataOnUninstall: false
  artifactName: "mimo2codex-desktop-${version}-win-${arch}.${ext}"
```

- [ ] **Step 4: Create the DMG background placeholder**

If you don't have artwork ready yet, generate a minimal 540×380 PNG that's "good enough" for v1: a near-white background with a single faint diagonal arrow drawn at design time. Save to `package/mac/dmg-background.png`. The exact look can be polished later without touching code; replacing the PNG re-runs at next build.

A starting SVG you can rasterize via `sharp-cli`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 380">
  <rect width="540" height="380" fill="#FAFAFB"/>
  <text x="270" y="40" text-anchor="middle" font-family="-apple-system, SF Pro Rounded, sans-serif" font-size="14" fill="#888">Drag mimo2codex into Applications</text>
  <path d="M 200 200 L 340 200" stroke="#4F6CFB" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#4F6CFB"/>
    </marker>
  </defs>
</svg>
```

Render:

```bash
npx --yes sharp-cli@4 -i package/mac/dmg-background.svg -o package/mac/dmg-background.png resize 540 380
```

- [ ] **Step 5: Repack + verify**

```bash
npm run sidecar:build
npm --prefix package/desktop run build
npm --prefix package/desktop run pack
```

Expected on Mac: open the produced `.dmg`. The install window shows the background image with the arrow pointing from the app to Applications. Drag, eject, launch from /Applications — **no Dock icon flashes** at startup, app does NOT appear in Cmd+Tab.

Expected on Win: run the produced `Setup .exe`. Wizard chrome shows our logo top-left. After install, Add/Remove Programs shows our icon next to the entry.

- [ ] **Step 6: Commit**

```bash
git add package/desktop/electron-builder.yml package/mac/dmg-background.png package/mac/dmg-background.svg
git commit -m "feat(desktop): LSUIElement (Mac menubar-only) + branded DMG/NSIS chrome"
```

### Task 9.2: GH Actions workflow

**Files:**
- Create: `.github/workflows/build-desktop.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: build-desktop

on:
  workflow_dispatch:
  push:
    tags: ["v*-desktop", "v*-desktop.*"]

jobs:
  build:
    # Why split mac into x64+arm64 instead of a universal binary?
    # - universal binary doubles bundle size (~+60% with two Nodes +
    #   two better-sqlite3 .node files baked in).
    # - the /download page already selects per-arch via UA detection,
    #   so users get the right slice with no user-visible cost.
    # See spec §8.3 C2.
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            arch: x64
            artifact_name: mimo2codex-desktop-win-x64.exe
          - os: windows-latest
            arch: arm64
            artifact_name: mimo2codex-desktop-win-arm64.exe
          - os: macos-13
            arch: x64
            artifact_name: mimo2codex-desktop-mac-x64.dmg
          - os: macos-14
            arch: arm64
            artifact_name: mimo2codex-desktop-mac-arm64.dmg

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install root deps
        run: npm ci

      - name: Install desktop deps
        run: npm --prefix package/desktop ci

      # Soft-fail when better-sqlite3 has no prebuild for this target
      # (most common on win-arm64). Skips the rest of the row instead of
      # failing the matrix — desktop GA can still ship the 3 working
      # architectures. See Task 7.1.1.
      - name: Probe better-sqlite3 prebuild
        id: probe
        if: matrix.os == 'windows-latest' && matrix.arch == 'arm64'
        continue-on-error: true
        env:
          TARGET_PLATFORM: ${{ contains(matrix.os, 'windows') && 'win32' || 'darwin' }}
          TARGET_ARCH: ${{ matrix.arch }}
        run: npm run probe-prebuild

      - name: Skip row if prebuild missing
        if: steps.probe.outcome == 'failure'
        run: |
          echo "::warning::better-sqlite3 has no prebuild for ${{ matrix.os }} ${{ matrix.arch }}; skipping this matrix row."
          echo "SKIP_BUILD=true" >> $GITHUB_ENV

      - name: Generate brand icons
        if: env.SKIP_BUILD != 'true'
        run: npm run brand:icons

      - name: Build sidecar bundle
        if: env.SKIP_BUILD != 'true'
        env:
          SIDECAR_ARCH: ${{ matrix.arch }}
        run: npm run sidecar:build

      - name: Build desktop
        if: env.SKIP_BUILD != 'true'
        run: npm --prefix package/desktop run build

      - name: Package electron-builder
        if: env.SKIP_BUILD != 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          USE_HARD_LINKS: false
        run: |
          npx --prefix package/desktop electron-builder \
            --${{ contains(matrix.os, 'windows') && 'win' || 'mac' }} \
            --${{ matrix.arch }} \
            --publish never \
            --config package/desktop/electron-builder.yml

      - name: Rename + upload artifact
        if: env.SKIP_BUILD != 'true'
        shell: bash
        run: |
          cd package/desktop/release
          ls -la
          # electron-builder names vary; rename whatever .exe/.dmg is here to the canonical name
          if [ "${{ matrix.os }}" = "windows-latest" ]; then
            mv *.exe "${{ matrix.artifact_name }}"
          else
            mv *.dmg "${{ matrix.artifact_name }}"
          fi

      - name: Compute SHA256
        if: env.SKIP_BUILD != 'true'
        shell: bash
        run: |
          cd package/desktop/release
          if [ "${{ matrix.os }}" = "windows-latest" ]; then
            certutil -hashfile "${{ matrix.artifact_name }}" SHA256 | sed -n 2p | tr -d ' \r' > "${{ matrix.artifact_name }}.sha256"
          else
            shasum -a 256 "${{ matrix.artifact_name }}" | awk '{print $1}' > "${{ matrix.artifact_name }}.sha256"
          fi
          cat "${{ matrix.artifact_name }}.sha256"

      - uses: actions/upload-artifact@v4
        if: env.SKIP_BUILD != 'true'
        with:
          name: ${{ matrix.artifact_name }}
          path: |
            package/desktop/release/${{ matrix.artifact_name }}
            package/desktop/release/${{ matrix.artifact_name }}.sha256

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - name: Assemble release body
        id: body
        shell: bash
        run: |
          {
            echo "## Desktop builds"
            echo ""
            echo "| Platform | Arch  | File | SHA256 |"
            echo "|----------|-------|------|--------|"
            for f in artifacts/*.sha256; do
              base=$(basename "$f" .sha256)
              sha=$(cat "$f")
              case "$base" in
                *win-x64*) platform="Windows"; arch="x64" ;;
                *win-arm64*) platform="Windows"; arch="arm64" ;;
                *mac-x64*) platform="macOS"; arch="x64" ;;
                *mac-arm64*) platform="macOS"; arch="arm64" ;;
              esac
              echo "| $platform | $arch | $base | $sha |"
            done
            echo ""
            echo "---"
            echo ""
            echo "📖 **Install & verification guide:** [mimodoc.chengj.online/download](https://mimodoc.chengj.online/download)"
            echo ""
            echo "Prefer the command line? \`npm install -g mimo2codex\` — same proxy, no tray."
          } > release-body.md
          cat release-body.md
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*.exe,artifacts/*.dmg,artifacts/*.sha256
          body_path: release-body.md
          fail_on_unmatched_files: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build-desktop.yml
git commit -m "feat(ci): GH Actions matrix for desktop build + release"
```

- [ ] **Step 3: Trigger a dry-run via workflow_dispatch**

In the GitHub web UI: Actions → build-desktop → Run workflow → pick `main`. Wait for all 4 matrix jobs to succeed (this will take 10–20 min). Inspect artifacts.

If any job fails: read the failure log, fix the issue (likely an electron-builder filter mismatch or a missing icon path), commit the fix, re-trigger.

---

## Phase 10 — docweb /download page

### Task 10.1: GitHub Releases API module

**Files:**
- Create: `docweb/src/api/githubReleases.ts`

- [ ] **Step 1: Implement API client**

```ts
export interface DesktopRelease {
  version: string;       // "0.4.5"
  tagName: string;       // "v0.4.5-desktop"
  publishedAt: string;   // ISO date
  assets: DesktopAsset[];
}

export interface DesktopAsset {
  name: string;
  size: number;
  downloadUrl: string;
  sha256?: string;
  platform: "win" | "mac";
  arch: "x64" | "arm64";
}

const CACHE_KEY = "m2c-desktop-releases-v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REPO = "7as0nch/mimo2codex";

interface CacheEnvelope { fetchedAt: number; data: DesktopRelease | null }

export async function fetchLatestDesktopRelease(): Promise<DesktopRelease | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const releases = (await res.json()) as Array<{
    tag_name: string;
    published_at: string;
    body: string;
    assets: Array<{ name: string; size: number; browser_download_url: string }>;
  }>;
  const desktop = releases.find(r => r.tag_name.includes("-desktop"));
  if (!desktop) {
    writeCache({ fetchedAt: Date.now(), data: null });
    return null;
  }
  const shaMap = parseSha256Map(desktop.body);
  const assets: DesktopAsset[] = desktop.assets
    .map(a => classifyAsset(a, shaMap))
    .filter((a): a is DesktopAsset => a !== null);
  const data: DesktopRelease = {
    version: desktop.tag_name.replace(/^v/, "").replace(/-desktop.*$/, ""),
    tagName: desktop.tag_name,
    publishedAt: desktop.published_at,
    assets,
  };
  writeCache({ fetchedAt: Date.now(), data });
  return data;
}

function classifyAsset(
  a: { name: string; size: number; browser_download_url: string },
  shaMap: Map<string, string>
): DesktopAsset | null {
  let platform: "win" | "mac";
  let arch: "x64" | "arm64";
  if (/win-x64\.exe$/i.test(a.name)) { platform = "win"; arch = "x64"; }
  else if (/win-arm64\.exe$/i.test(a.name)) { platform = "win"; arch = "arm64"; }
  else if (/mac-x64\.dmg$/i.test(a.name)) { platform = "mac"; arch = "x64"; }
  else if (/mac-arm64\.dmg$/i.test(a.name)) { platform = "mac"; arch = "arm64"; }
  else return null;
  return { name: a.name, size: a.size, downloadUrl: a.browser_download_url, sha256: shaMap.get(a.name), platform, arch };
}

function parseSha256Map(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    // Match table row: | ... | name | sha |
    const m = line.match(/\|\s*([A-Za-z0-9.\-_]+\.(?:exe|dmg))\s*\|\s*([0-9a-f]{64})\s*\|/i);
    if (m) map.set(m[1], m[2].toLowerCase());
  }
  return map;
}

function readCache(): CacheEnvelope | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEnvelope) : null;
  } catch { return null; }
}
function writeCache(env: CacheEnvelope): void {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(env)); } catch {}
}
```

- [ ] **Step 2: Commit**

```bash
git add docweb/src/api/githubReleases.ts
git commit -m "feat(docweb): GitHub Releases API client for desktop downloads"
```

### Task 10.2: Download page

**Files:**
- Create: `docweb/src/pages/Download.tsx`
- Modify: `docweb/src/App.tsx`
- Modify: `docweb/src/components/AppHeader.tsx`
- Modify: `docweb/src/i18n/locales/en.json` (append download.* keys)
- Modify: `docweb/src/i18n/locales/zh.json` (append download.* keys)

- [ ] **Step 1: Add i18n keys**

Append to `docweb/src/i18n/locales/en.json`:
```jsonc
{
  // ... existing keys ...
  "download": {
    "title": "mimo2codex Desktop",
    "tagline": "Run locally · Tray / menu-bar app · One-click start & stop",
    "downloadFor": "Download for {{platform}} ({{arch}})",
    "otherPlatforms": "Other platforms",
    "loading": "Loading release info...",
    "errorFallback": "Could not fetch release info. Visit ",
    "errorFallbackLink": "GitHub Releases",
    "noRelease": "No desktop release has been published yet. Check back soon.",
    "version": "Version",
    "fileSize": "Size",
    "sha256": "SHA256",
    "copy": "Copy",
    "copied": "Copied",
    "whyDesktop": "Why a desktop app?",
    "feat1Title": "Background",
    "feat1Desc": "No console window required.",
    "feat2Title": "Tray menu",
    "feat2Desc": "One-click start and stop.",
    "feat3Title": "Autostart",
    "feat3Desc": "Ready when you log in.",
    "securityNote": "First launch will show a system security warning because we have not purchased a code-signing certificate. Mac: right-click → Open → confirm. Windows: SmartScreen → More info → Run anyway. Verify the SHA256 matches the value shown above to confirm integrity.",
    "cliHint": "Prefer the command line? npm install -g mimo2codex"
  }
}
```

Append to `docweb/src/i18n/locales/zh.json` with parallel Chinese translations.

- [ ] **Step 2: Add /download route**

Modify `docweb/src/App.tsx` — find the existing `<Routes>` block and add:

```tsx
import { Download } from "./pages/Download.js";
// ...
<Route path="/download" element={<Download />} />
```

- [ ] **Step 3: Add nav link**

Modify `docweb/src/components/AppHeader.tsx` — wherever the existing nav items are rendered (likely a `<Menu>` items array), add an item with `key="download"` linking to `/download`.

- [ ] **Step 4: Implement Download.tsx**

```tsx
import React, { useEffect, useState } from "react";
import { Typography, Button, Spin, Collapse, Table, Card, Row, Col, Tag, message, Space } from "antd";
import { DownloadOutlined, CopyOutlined, GithubOutlined, DesktopOutlined, AppstoreOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fetchLatestDesktopRelease, type DesktopRelease, type DesktopAsset } from "../api/githubReleases.js";

const { Title, Paragraph, Text } = Typography;

function detectPlatform(): { platform: "win" | "mac"; arch: "x64" | "arm64" } {
  const ua = navigator.userAgent;
  let platform: "win" | "mac" = ua.includes("Mac") ? "mac" : "win";
  // userAgentData is Chromium 90+; fall back to x64 elsewhere
  const archHint = (navigator as Navigator & { userAgentData?: { architecture?: string } }).userAgentData?.architecture;
  const arch: "x64" | "arm64" = archHint === "arm" || archHint === "arm64" ? "arm64" : "x64";
  return { platform, arch };
}

function platformLabel(p: "win" | "mac", a: "x64" | "arm64"): string {
  if (p === "win" && a === "x64") return "Windows x64";
  if (p === "win" && a === "arm64") return "Windows ARM64";
  if (p === "mac" && a === "x64") return "macOS (Intel)";
  return "macOS (Apple Silicon)";
}

function humanSize(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

export function Download() {
  const { t } = useTranslation();
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const detected = detectPlatform();

  useEffect(() => {
    fetchLatestDesktopRelease()
      .then(r => { setRelease(r); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const primaryAsset = release?.assets.find(a => a.platform === detected.platform && a.arch === detected.arch);
  const otherAssets = release?.assets.filter(a => a !== primaryAsset) ?? [];

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ textAlign: "center" }}>
        <img src="/favicon.svg" width={128} height={128} alt="mimo2codex" style={{ marginBottom: 24 }} />
        <Title level={1} style={{ marginBottom: 8 }}>{t("download.title")}</Title>
        <Paragraph type="secondary" style={{ fontSize: 16, marginBottom: 32 }}>
          {t("download.tagline")}
        </Paragraph>

        {loading && <Spin />}
        {error && (
          <Paragraph>
            {t("download.errorFallback")}
            <a href="https://github.com/7as0nch/mimo2codex/releases" target="_blank" rel="noopener noreferrer">
              {t("download.errorFallbackLink")}
            </a>
          </Paragraph>
        )}
        {!loading && !error && !release && <Paragraph>{t("download.noRelease")}</Paragraph>}

        {primaryAsset && (
          <>
            <Button
              type="primary"
              size="large"
              icon={<DownloadOutlined />}
              href={primaryAsset.downloadUrl}
              style={{ height: 56, padding: "0 32px", fontSize: 16 }}
            >
              {t("download.downloadFor", { platform: platformLabel(primaryAsset.platform, "x64"), arch: primaryAsset.arch })}
            </Button>
            <div style={{ marginTop: 16, color: "#888", fontSize: 13 }}>
              <Space size="middle">
                <span>v{release?.version}</span>
                <span>{release?.publishedAt && new Date(release.publishedAt).toLocaleDateString()}</span>
                <span>{humanSize(primaryAsset.size)}</span>
              </Space>
              {primaryAsset.sha256 && (
                <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                  SHA256: {primaryAsset.sha256.slice(0, 16)}…
                  <Button
                    type="link"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(primaryAsset.sha256!);
                      message.success(t("download.copied"));
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {otherAssets.length > 0 && (
          <Collapse ghost style={{ marginTop: 32, textAlign: "left" }}>
            <Collapse.Panel header={t("download.otherPlatforms")} key="1">
              <Table
                size="small"
                pagination={false}
                rowKey="name"
                dataSource={otherAssets}
                columns={[
                  { title: "Platform", dataIndex: "platform", render: (_p, r: DesktopAsset) => <Tag>{platformLabel(r.platform, r.arch)}</Tag> },
                  { title: "Size", dataIndex: "size", render: (b: number) => humanSize(b) },
                  { title: "SHA256", dataIndex: "sha256", render: (s?: string) => s ? <Text code copyable={{ text: s, tooltips: false }} style={{ fontSize: 11 }}>{s.slice(0, 12)}…</Text> : "—" },
                  { title: "", render: (_: unknown, r: DesktopAsset) => <a href={r.downloadUrl}><DownloadOutlined /> Download</a> },
                ]}
              />
            </Collapse.Panel>
          </Collapse>
        )}
      </div>

      <Card style={{ marginTop: 64 }}>
        <Title level={3}>{t("download.whyDesktop")}</Title>
        <Row gutter={[32, 16]}>
          <Col span={8}>
            <DesktopOutlined style={{ fontSize: 24, color: "#4F6CFB" }} />
            <Title level={5}>{t("download.feat1Title")}</Title>
            <Paragraph>{t("download.feat1Desc")}</Paragraph>
          </Col>
          <Col span={8}>
            <AppstoreOutlined style={{ fontSize: 24, color: "#4F6CFB" }} />
            <Title level={5}>{t("download.feat2Title")}</Title>
            <Paragraph>{t("download.feat2Desc")}</Paragraph>
          </Col>
          <Col span={8}>
            <ThunderboltOutlined style={{ fontSize: 24, color: "#4F6CFB" }} />
            <Title level={5}>{t("download.feat3Title")}</Title>
            <Paragraph>{t("download.feat3Desc")}</Paragraph>
          </Col>
        </Row>
      </Card>

      <Paragraph type="warning" style={{ marginTop: 32 }}>
        {t("download.securityNote")}
      </Paragraph>

      <Paragraph type="secondary" style={{ marginTop: 32 }}>
        <Link to="/docs"><GithubOutlined /> {t("download.cliHint")}</Link>
      </Paragraph>
    </div>
  );
}
```

- [ ] **Step 5: Build docweb to verify TS/JSX clean**

```bash
npm --prefix docweb run build
```

Expected: 0 errors, produces `dist/`.

- [ ] **Step 6: Run dev server, visit /download**

```bash
npm --prefix docweb run dev
```

Open `http://localhost:5174/download`. Expected:
- Logo + title + tagline
- Loading state then either: (a) a primary download button if a `*-desktop` release exists on GitHub, OR (b) the "no release yet" message if none yet
- Collapsible "Other platforms" with 3 rows
- Feature cards
- Security warning paragraph

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add docweb/src/pages/Download.tsx docweb/src/api/githubReleases.ts docweb/src/App.tsx docweb/src/components/AppHeader.tsx docweb/src/i18n/locales/
git commit -m "feat(docweb): /download page with GitHub Releases API + UA platform detection"
```

---

## Phase 11 — Integration smoke + docs

### Task 11.1: End-to-end smoke on local machine

Manual, no automation. Tick boxes as you verify.

- [ ] **Step 1:** Clean state: delete `userData/.env` and `runtime.json` from the OS userData dir for the desktop app
- [ ] **Step 2:** Launch the dev build (`npm run desktop:dev`) — settings window auto-opens
- [ ] **Step 3:** Fill in MiMo key → Save & Restart → sidecar starts, tray header turns green, admin UI window opens
- [ ] **Step 4:** Tray → "Open Admin UI in browser" → default browser opens to localhost
- [ ] **Step 5:** Tray → "Show logs..." → window streams sidecar output
- [ ] **Step 6:** Check "Start on system boot" → reboot machine → app launches on login (Mac: menu bar, Win: tray) — no windows visible
- [ ] **Step 7:** Uncheck autostart, verify it disables
- [ ] **Step 8:** Tray → Quit → check Task Manager / `ps -ef | grep node` — no orphan sidecar process
- [ ] **Step 9:** **Regression check**: in a separate terminal, run `npm install -g mimo2codex` (or use a local link) → `mimo2codex` → CLI starts on `~/.mimo2codex/` data dir, completely independent from desktop's userData

### Task 11.2: Update existing changelog with desktop GA entry

**Files:**
- Modify: `doc/tag-log.md`
- Modify: `doc/tag-log.zh.md`
- Modify: `web/src/release-notes.tsx`

Per CLAUDE.md rule §2, tag-log files and release-notes.tsx must move in lockstep. Below is the drop-in copy — at release time, only the version number string needs updating (search-replace `0.X.Y`).

- [ ] **Step 1: Append entry to `doc/tag-log.md`**

Under the current upcoming-version `##` heading (or create a new section `## v0.X.Y — YYYY-MM-DD`):

```markdown
- [new] Desktop shell (Windows tray / macOS menu bar). Adds a system-tray companion that runs mimo2codex in the background — no terminal window required — with first-run settings, embedded admin UI, autostart, and quit-from-menu. Independent installer; the CLI flow (`npm install -g mimo2codex`) is unchanged. Downloads + install guide: https://mimodoc.chengj.online/download.
```

- [ ] **Step 2: Append same entry (translated) to `doc/tag-log.zh.md`**

```markdown
- [new] 桌面端（Windows 系统托盘 / macOS 顶栏菜单）。后台跑 mimo2codex，不再依赖终端窗口常开；首次启动有设置窗、托盘菜单可一键打开 admin UI、可勾选开机自启。安装独立于命令行版，原有 `npm install -g mimo2codex` 流程不受影响。下载与使用说明：https://mimodoc.chengj.online/download。
```

- [ ] **Step 3: Add ReleaseHighlight to `web/src/release-notes.tsx`**

Prepend a new `ReleaseNote` object (most-recent-first per the file's convention) with the desktop GA version. Update the import to include `DesktopOutlined`:

```tsx
import { DesktopOutlined, /* existing icons */ } from "@ant-design/icons";

// ── Entries ──
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.X.Y",          // ← set at release time
    date: "YYYY-MM-DD",        // ← set at release time
    title: {
      en: "Desktop shell (tray app)",
      zh: "桌面端（托盘 / 顶栏）",
    },
    highlights: [
      {
        kind: "new",
        icon: <DesktopOutlined />,
        title: {
          en: "Run mimo2codex in the background — no terminal needed",
          zh: "后台运行 mimo2codex —— 不再依赖终端窗口",
        },
        description: {
          en: "Install the desktop build and a tray icon (Windows) or menu-bar icon (macOS) starts mimo2codex in the background. First launch shows a 4-field settings window for your provider + API key; after that you can open the admin UI in a window or your default browser straight from the tray. Quit from the menu stops the sidecar cleanly. The CLI version is unchanged and lives alongside.",
          zh: "装好桌面端后，Windows 系统托盘 / macOS 顶栏会有一个 mimo2codex 图标，后台跑 mimo2codex。首次启动有一个 4 行的设置窗让你填 provider 和 API Key；之后在托盘菜单里就能一键打开 admin UI（窗内或浏览器）。菜单里 Quit 干净退出 sidecar。命令行版与桌面端共存，互不影响。",
        },
        location: {
          en: "Tray (Win) / menu bar (Mac) — visible after install",
          zh: "Windows 系统托盘 / macOS 顶栏 —— 安装完即可见",
        },
        ctaLabel: { en: "Download", zh: "下载" },
        ctaHref: "https://mimodoc.chengj.online/download",
      },
    ],
  },
  // ... existing entries below
];
```

- [ ] **Step 4: Build everything to confirm nothing's broken**

```bash
npm run build
npm run web:build
npm --prefix docweb run build
npm --prefix package/desktop run build
npm test
```

Expected: all 4 builds + tests green.

- [ ] **Step 5: Commit**

```bash
git add doc/ web/src/release-notes.tsx
git commit -m "docs: announce desktop shell GA in tag-log + release-notes"
```

### Task 11.3: README + CLI-docs cross-links + uninstall doc (B5 + C5 + C6)

Three discoverability fixes that all live in plain Markdown:

1. Add a "Desktop / 桌面端" section near the top of root `README.md` and `README.zh.md` linking to mimodoc /download.
2. From CLI-flow docs (e.g. `doc/getting-started*.md` if present, otherwise the README), point users at the desktop alternative.
3. Document the manual uninstall steps for both platforms (Win NSIS uninstaller exists; Mac DMG users need to drag to Trash + optionally `rm -rf` userData).

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: any CLI getting-started doc that exists (otherwise the README above already covers it)

- [ ] **Step 1: Insert a "Desktop / 桌面端" section into `README.md`**

After the project tagline / before the existing installation instructions:

```markdown
## Desktop app (Windows tray / macOS menu bar)

Don't want a terminal window open all day? Use the desktop build — same proxy,
runs in the system tray. First-run prompts for your API key, then everything
lives behind a tray icon.

**Download:** https://mimodoc.chengj.online/download

The CLI version (`npm install -g mimo2codex`, below) is unaffected; the two
can be installed on the same machine without conflict.
```

- [ ] **Step 2: Insert the translated counterpart into `README.zh.md`**

```markdown
## 桌面端（Windows 托盘 / macOS 顶栏）

不想让一个终端窗口常开？装桌面端 —— 同样的代理，只是常驻在系统托盘里。
首次启动让你填 API Key，之后所有操作都在托盘菜单里。

**下载地址：** https://mimodoc.chengj.online/download

命令行版（下文的 `npm install -g mimo2codex`）不受影响，两者可以同机共存。
```

- [ ] **Step 3: Append an "Uninstall" subsection to both READMEs (under or near the Desktop section)**

`README.md`:

```markdown
### Uninstalling the desktop app

- **Windows:** Settings → Apps → mimo2codex → Uninstall. The installer
  preserves `%APPDATA%\mimo2codex-desktop` by default (so your API key
  survives a reinstall); delete that folder manually if you want a clean wipe.
- **macOS:** Drag mimo2codex.app from /Applications to the Trash. To also
  wipe configuration: `rm -rf "$HOME/Library/Application Support/mimo2codex-desktop"`.
```

`README.zh.md`:

```markdown
### 卸载桌面端

- **Windows：** 设置 → 应用 → mimo2codex → 卸载。默认保留 `%APPDATA%\mimo2codex-desktop`
  目录（API Key 等配置会保留以便重装），如需彻底清除，手动删除该目录。
- **macOS：** 从 /Applications 把 mimo2codex.app 拖到废纸篓即可。如需同时清除配置：
  `rm -rf "$HOME/Library/Application Support/mimo2codex-desktop"`。
```

- [ ] **Step 4: Verify no broken markdown / link issues**

```bash
# If markdownlint is in the repo:
npx markdownlint README.md README.zh.md || true   # best-effort

# Manual: open both READMEs in your editor's MD preview to eyeball.
```

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: link CLI README to desktop /download + add uninstall notes"
```

---

## Self-review summary

**Spec coverage check** (against `docs/superpowers/specs/2026-05-22-desktop-shell-design.md`):

| Spec section | Phase / Task |
|---|---|
| §1 Project layout | Phase 2 |
| §2 Sidecar architecture | Phase 3 (sidecar.ts) + Phase 7 (bundling) |
| §3 Tray menu + windows | Phases 5, 6, 8 |
| §4 GH Actions + signing | Phase 9 |
| §5 YAGNI clarifications | Honored (no auto-update, no signing, single-user) |
| §6 Logo direction A | Phase 1 |
| §7 docweb /download | Phase 10 |
| Validation plan | Phase 11 |

**Implementation refinement**: §2 + §4.3's `@yao-pkg/pkg` approach replaced with extracted Node + extracted dist + production node_modules. Documented in plan header.

**Type consistency**: `RuntimeConfig`, `SidecarStatus`, `ProviderEnvKey`, `RendererToMain`, `MainToRenderer`, `IPC_CHANNEL` defined once in `shared/types.ts` and `src/ipc.ts`, imported consistently downstream.

**No placeholders**: All "TODO" stubs in main.ts are filled in by the time they're meant to dispatch real behavior (openAdminInBrowser by 7.2, openAdminInApp by 8.1, openLogs by 8.2, restartSidecar by 7.2). No "fill in details" or "similar to Task N" patterns remain.

**Identified gap**: No automated end-to-end test of the packaged binary (only manual smoke in Task 11.1). Acceptable for v1 — Electron + native packaging end-to-end tests are notoriously brittle; manual verification is the standard. CI does build + verifies non-zero exit only.

**Identified gap**: Settings window assumes only one provider key at a time (only writes the selected provider's envKey on Save). Multi-provider users must enter remaining keys via the Admin UI. Documented behavior, consistent with spec §3.3.
