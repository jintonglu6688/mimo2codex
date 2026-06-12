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
// Keep entries user-facing and SHORT — one line per change. The full prose
// lives in doc/tag-log.{md,zh.md}; here we mirror every tag-log change briefly
// so the modal stays scannable. We keep ONLY the latest version's entry.

import type { ReactNode } from "react";
// Bundled by Vite → emitted under dist/web/assets/, served at /admin/assets/*.
import phoneDesktopImg from "./assets/phone-desktop.jpg";

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
  /** Optional hero image for the release (shown under the summary). */
  image?: { src: string; alt: BilingualText };
  highlights: ReleaseHighlight[];
}

// ── Entries ──────────────────────────────────────────────────────────────
// Most recent first. We keep ONLY the latest version here so the in-app
// "What's new" modal stays tight — older release detail lives in
// doc/tag-log.{md,zh.md} for users who want the full history.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.5.27",
    date: "2026-06-11",
    title: {
      en: "Keep your ChatGPT login + smarter model routing",
      zh: "保留 ChatGPT 登录 + 更智能的模型路由",
    },
    summary: {
      en: "Stay signed into ChatGPT while running mimo2codex models (and drive Codex from your phone); the client's requested model is now honored over a runtime override; plus desktop admin-DB and Base-URL fixes.",
      zh: "保持 ChatGPT 登录的同时使用 mimo2codex 模型(还能用手机操作电脑上的 Codex);客户端传入的模型现在优先于运行时覆盖;另含桌面端管理后台数据库与 Base URL 修复。",
    },
    image: {
      src: phoneDesktopImg,
      alt: {
        en: "Codex on a phone driving the desktop while using a custom mimo2codex model (config.toml) — the ChatGPT login is preserved.",
        zh: "手机上的 Codex 操作电脑端,同时使用自定义的 mimo2codex 模型(config.toml)——ChatGPT 登录被保留。",
      },
    },
    highlights: [
      {
        kind: "new",
        title: {
          en: "Keep your ChatGPT login while the model runs through mimo2codex",
          zh: "保留 ChatGPT 登录的同时,模型走 mimo2codex 代理",
        },
        description: {
          en: "You can now stay signed into your real ChatGPT account and route the model through mimo2codex at the same time — the prerequisite for OpenAI's official \"Codex mobile/remote\" (driving this computer's Codex from your phone). Enabling a provider on a machine with a real login now keeps ~/.codex/auth.json untouched and only redirects the model, instead of overwriting your login; a checkbox still lets you overwrite if you prefer. Heads up: whether OpenAI's remote mode actually uses the proxy backend is undocumented — test it and confirm in the logs.",
          zh: "现在你可以一边保持真实 ChatGPT 账号登录,一边把模型走 mimo2codex 代理 —— 这正是用 OpenAI 官方「Codex 手机端/远程」(用手机操作这台电脑上的 Codex)的前提。在已登录的机器上启用 provider,现在会保留 ~/.codex/auth.json 不动、只重定向模型,而不再覆盖你的登录;如需覆盖仍可在弹窗里勾选。注意:官方远程模式到底会不会用代理后端没有官方文档,请实测并在日志里确认。",
        },
        location: {
          en: "Codex Enable page → \"Control this Codex from your phone\" card + the confirm dialog when enabling",
          zh: "「Codex 启用」页 → 「用手机操作这台 Codex」卡片,以及启用时的确认弹窗",
        },
        ctaLabel: { en: "Open Codex Enable", zh: "打开 Codex 启用" },
        ctaPath: "/codex",
      },
      {
        kind: "improved",
        title: {
          en: "Your model choice now beats a runtime override",
          zh: "你传入的模型现在优先于运行时覆盖",
        },
        description: {
          en: "When Codex requests a model mimo2codex recognizes (a built-in, or a configured provider model), that model is now used even if you've set a runtime override — the override no longer hijacks an explicitly-chosen model. The override still kicks in (before the default fallback) for model ids no provider recognizes. Priority: your client model → runtime override → config default.",
          zh: "当 Codex 请求的模型是 mimo2codex 能识别的(内置或已配置的 provider 模型)时,现在会直接用这个模型,即使你设了运行时覆盖——覆盖不再劫持你明确选定的模型。对于没有 provider 能识别的模型 id,覆盖仍会在默认兜底之前生效。优先级:客户端模型 → 运行时覆盖 → 配置默认。",
        },
        location: {
          en: "Codex Enable page → Thinking & Override tab (runtime override is now a fallback)",
          zh: "「Codex 启用」页 → 思考与运行时覆盖 标签(运行时覆盖现在是兜底)",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Apple-Silicon desktop /admin/ no longer fails with a baffling 404",
          zh: "Apple Silicon 桌面端 /admin/ 不再回令人费解的 404",
        },
        description: {
          en: "On some Macs the desktop app's /admin/ returned a misleading \"no route\" 404 because the bundled database module failed to load and the admin console was silently disabled. It now returns a clear 503 that names the real reason and how to fix it (reinstall / run `xattr -cr` on the app). The desktop packaging was also hardened so a broken native module can't ship: each build now runs the packaged app end-to-end and refuses to publish if the admin console doesn't come up.",
          zh: "部分 Mac 上桌面端 /admin/ 会回误导性的「no route」404 —— 实际是内置数据库模块加载失败、管理后台被静默关闭。现在改回清晰的 503,直接说明真实原因与修复办法(重装 / 对 app 执行 `xattr -cr`)。同时加固了桌面端打包:每次构建都会端到端跑一遍打包后的应用,管理后台起不来就拒绝发布,杜绝坏的原生模块上车。",
        },
        location: {
          en: "Desktop app → open /admin/ (a failed DB now explains itself)",
          zh: "桌面端 → 打开 /admin/(DB 加载失败会自解释)",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Blank Base URL no longer leaves the upstream host empty",
          zh: "Base URL 留空不再导致上游主机为空",
        },
        description: {
          en: "If you left the Base URL field blank in Settings, the proxy could end up with no upstream host (the startup banner showed an empty 'upstream:') — so requests had nowhere to go. A blank Base URL now correctly falls back to the right MiMo host based on your key prefix (tp- → token-plan, sk- → pay-as-you-go). Existing setups are auto-fixed on upgrade — no need to re-enter anything.",
          zh: "如果你在设置里把 Base URL 留空,代理可能会没有上游主机(启动 banner 的 'upstream:' 是空的),请求就发不出去。现在 Base URL 留空会正确按 key 前缀回落到对应的 MiMo 主机(tp- → 套餐版,sk- → 按量付费)。已有配置升级后自动修复,无需重填。",
        },
        location: {
          en: "Desktop Settings → Base URL (leave empty to use default)",
          zh: "桌面端设置 → Base URL(留空使用默认)",
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
