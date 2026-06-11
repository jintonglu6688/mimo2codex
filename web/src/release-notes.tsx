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
// Most recent first. We keep ONLY the latest version here so the in-app
// "What's new" modal stays tight — older release detail lives in
// doc/tag-log.{md,zh.md} for users who want the full history.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.5.27",
    date: "2026-06-11",
    title: {
      en: "Desktop: clearer error when the admin DB can't load",
      zh: "桌面端:管理后台数据库加载失败时给出明确错误",
    },
    summary: {
      en: "Fixes the Apple-Silicon desktop /admin/ 404 and a blank Base URL leaving the upstream host empty.",
      zh: "修复 Apple Silicon 桌面端 /admin/ 404,以及 Base URL 留空导致上游主机为空的问题。",
    },
    highlights: [
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
