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
    version: "0.5.28",
    date: "2026-06-22",
    title: {
      en: "Faster admin dashboard + web search is now opt-in",
      zh: "管理后台更快 + 联网搜索改为可选",
    },
    summary: {
      en: "The Overview/Logs pages no longer crawl on a large database (stats now come from an incremental rollup), and MiMo web search is off by default so accounts without the plugin stop erroring.",
      zh: "概览/日志页在大数据库下不再卡顿(统计改用增量汇总表);MiMo 联网搜索默认关闭,没开插件的账户不再报错。",
    },
    highlights: [
      {
        kind: "improved",
        title: {
          en: "Admin dashboard stays fast even with a huge log database",
          zh: "日志库很大时管理后台依然流畅",
        },
        description: {
          en: "On a large data.db (one user hit 22 GB), the Overview and Logs pages could take 10+ minutes to load because every visit re-aggregated the entire chat_logs table — which also stalled the proxy itself. Stats now come from a small hourly rollup table updated as logs are written, so the dashboard stays fast no matter how big the log database grows. Existing history is backfilled in the background. Tip: the speed-up doesn't shrink the file — set a retention period or 'errors-only' body capture in the Logs page's storage settings to reclaim space.",
          zh: "在很大的 data.db 上,概览和日志页会要十几分钟才打开——因为每次都在整张 chat_logs 大表上重新聚合,连代理本身也被拖住。现在统计改由一张随写日志同步更新的「按小时汇总表」提供,无论日志库多大,后台都保持流畅;历史数据在后台回填。提示:后台变快不会缩小文件——在日志页「存储设置」里设保留天数或改成仅存错误体来回收空间。",
        },
        location: {
          en: "Overview & Logs pages (and storage settings on the Logs page)",
          zh: "概览 & 日志页(以及日志页的「存储设置」)",
        },
        ctaLabel: { en: "Open Logs", zh: "打开日志" },
        ctaPath: "/logs",
      },
      {
        kind: "fixed",
        title: {
          en: "MiMo web search no longer errors when the plugin isn't activated",
          zh: "MiMo 联网搜索在未开通插件时不再报错",
        },
        description: {
          en: "If your MiMo account didn't have the (separately-billed) Web Search Plugin, requests could fail in a loop with 'webSearchEnabled is false' — because mimo2codex forwarded Codex's web_search tool to pay-as-you-go (sk-) accounts. Web search is now OFF by default and only forwarded if you opt in. Turn it on (only if your account has the plugin) on the Codex Enable page, or with --web-search.",
          zh: "如果你的 MiMo 账户没有开通(单独计费的)联网插件,请求会以 'webSearchEnabled is false' 循环报错——因为 mimo2codex 把 Codex 的 web_search 工具转发给了按量付费(sk-)账户。现在联网搜索默认关闭,只有你主动开启才转发。需要时(且账户已开通插件)在 Codex 启用页打开,或用 --web-search。",
        },
        location: {
          en: "Codex Enable page → Thinking & Override → Web search",
          zh: "「Codex 启用」页 → 思考与运行时覆盖 → 联网搜索",
        },
        ctaLabel: { en: "Open Codex Enable", zh: "打开 Codex 启用" },
        ctaPath: "/codex",
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
