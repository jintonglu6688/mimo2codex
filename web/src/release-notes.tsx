// Release notes shown in the "What's New" modal on admin first-load after a
// version bump. Maintained as a hand-rolled data file (TSX, not JSON, so we
// can drop in icons and the occasional ReactNode without losing TS safety).
//
// How to add an entry when you ship a new version:
//   1. Bump package.json `version` (via `npm run release:patch` etc.).
//   2. Update doc/tag-log{,.zh}.md as before (the WhatsNew modal complements
//      tag-log, it does not replace it).
//   3. Prepend a new `ReleaseNote` to RELEASE_NOTES below. Most recent first.
//      The modal auto-shows it to users whose lastSeenVersion is below it.
//
// Keep entries user-facing: highlight what changed from the user's seat, name
// the menu / button / page where the new thing lives, and (optionally) wire a
// CTA that navigates straight to it.

import type { ReactNode } from "react";
import { DesktopOutlined } from "@ant-design/icons";

export interface BilingualText {
  en: string;
  zh: string;
}

export interface ReleaseHighlight {
  icon?: ReactNode;
  /** Section badge: "new" | "improved" | "fixed" | "doc" */
  kind?: "new" | "improved" | "fixed" | "doc";
  title: BilingualText;
  description: BilingualText;
  /** Plain-text breadcrumb so users can find the new feature themselves. */
  location?: BilingualText;
  /** Optional CTA. ctaPath wins → react-router navigate; else ctaHref opens new tab. */
  ctaLabel?: BilingualText;
  ctaPath?: string;
  ctaHref?: string;
}

export interface ReleaseNote {
  version: string; // semver "0.4.2"
  date: string;    // "2026-05-21" ISO
  title: BilingualText;
  summary?: BilingualText;
  highlights: ReleaseHighlight[];
}

// ── Entries ──────────────────────────────────────────────────────────────
// Most recent first. Per the v0.4.3 release: we keep ONLY the latest version
// here so the in-app "What's new" modal stays tight — older release detail
// lives in doc/tag-log.{md,zh.md} for users who want the full history.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.4.8",
    date: "2026-05-23",
    title: {
      en: "Desktop preview (beta) — Windows / macOS downloads",
      zh: "桌面预览（beta）—— Windows / macOS 包下载",
    },
    summary: {
      en: "First beta of the mimo2codex desktop app. Runs in the background as a tray / menu-bar process; no terminal required. We'd love your install + first-run feedback.",
      zh: "mimo2codex 桌面端首个 beta。以系统托盘 / 顶栏进程后台运行，不依赖终端窗口。欢迎试用并反馈安装 + 首次启动的体验。",
    },
    highlights: [
      {
        kind: "new",
        icon: <DesktopOutlined />,
        title: {
          en: "Windows tray / macOS menu-bar app (beta)",
          zh: "Windows 系统托盘 / macOS 顶栏桌面端（beta）",
        },
        description: {
          en: "Optional companion app that runs mimo2codex in the background — no terminal window kept open. First launch shows a small settings window to pick a provider + paste an API key; after that the tray / menu-bar icon opens the admin UI in a window or your default browser. Quit from the menu stops the sidecar cleanly. The CLI install (`npm install -g mimo2codex`) is unchanged and can coexist on the same machine. This is a beta — please report any installer / launch / sidecar issues on the download page or via a GitHub issue.",
          zh: "可选的桌面壳子，后台跑 mimo2codex，不用一直开着终端窗口。首次启动会有个小设置窗让你选 provider 并粘贴 API Key；之后从系统托盘 / 顶栏图标一键打开 admin UI（窗内或默认浏览器）。菜单 Quit 干净退出 sidecar。命令行版（`npm install -g mimo2codex`）完全不变，两者可在同一台机器共存。这是 beta —— 安装 / 启动 / sidecar 相关问题欢迎在下载页或 GitHub issue 反馈。",
        },
        location: {
          en: "Windows system tray / macOS menu bar — appears after install",
          zh: "Windows 系统托盘 / macOS 顶栏 —— 安装完成后即可见",
        },
        ctaLabel: { en: "Download & feedback", zh: "下载体验 & 反馈" },
        ctaHref: "https://mimodoc.chengj.online/download",
      },
      {
        kind: "fixed",
        title: {
          en: "DeepSeek 400 \"Invalid assistant message\" with Chrome plugin (issue #29)",
          zh: "Chrome 插件触发 DeepSeek 400 \"Invalid assistant message\" 已修复（issue #29）",
        },
        description: {
          en: "Assistant turns translated from a reasoning + function_call sequence (Codex Chrome plugin pattern) no longer emit `content: null` — DeepSeek V4 rejected that shape. The field is now omitted per OpenAI spec when tool_calls is present; reasoning-only turns get `content: \"\"`.",
          zh: "由 reasoning + function_call 拼成的 assistant 回合（Codex Chrome 插件场景）不再发 `content: null` —— DeepSeek V4 之前会按\"两个字段都没\"拒绝。tool_calls 存在时按 OpenAI 规范省略 content；reasoning-only 回合补 `content: \"\"`。",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Windows + pnpm-global + Node 22 startup no longer crashes (issue #30)",
          zh: "Windows + pnpm 全局安装 + Node 22 启动不再崩溃（issue #30）",
        },
        description: {
          en: "When better-sqlite3's native binding can't load (typical: pnpm global on Windows with no prebuilt for Node 22's ABI), mimo2codex now logs a clear warning and starts with the admin DB disabled instead of exiting. Core proxy translation never needed the DB.",
          zh: "better-sqlite3 native binding 加载失败时（典型：Windows pnpm 全局安装且 Node 22 没拿到对应 ABI 的 prebuilt），mimo2codex 现在打印清晰告警并以 admin 关闭模式继续启动，不再退出。代理核心翻译本来就不依赖 DB。",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "CodeX Desktop string-input misidentified as probe (PR #31, thanks @85339098-afk)",
          zh: "CodeX Desktop 的 string input 被误判为 probe（PR #31，感谢 @85339098-afk）",
        },
        description: {
          en: "OpenAI's Responses API allows `input` to be a string or an array; the probe detector only matched the array form, so `{model, input: \"hello\"}` (CodeX Desktop's natural shape) was short-circuited to an empty `output: []` with no upstream call — looked like \"model said nothing\" with no error signal. Non-empty string `input` is now correctly recognized as a real request.",
          zh: "OpenAI Responses API 允许 `input` 是 string 或数组；之前 probe 检测只认数组形式，导致 `{model, input: \"hello\"}`（CodeX Desktop 的自然形状）被短路成 `output: []` 空响应、完全不调上游 —— 看起来像\"模型啥也没说\"且没有错误信号。现在 string `input` 非空也会正确走完整翻译流程。",
        },
      },
    ],
  },
];

// ── Semver compare ────────────────────────────────────────────────────────
export function compareVersion(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/, "").split(".").map((n) => {
      const m = /^(\d+)/.exec(n);
      return m ? parseInt(m[1], 10) : 0;
    });
  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

// Releases the user has not yet acknowledged, capped at the running version
// (so a release-notes.tsx entry for a *future* version doesn't leak through).
export function unseenReleases(
  lastSeen: string | null,
  current: string,
): ReleaseNote[] {
  const baseline = lastSeen ?? "0.0.0";
  return RELEASE_NOTES.filter(
    (n) =>
      compareVersion(n.version, baseline) > 0 &&
      compareVersion(n.version, current) <= 0,
  );
}
