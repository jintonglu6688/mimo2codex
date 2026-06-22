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
      en: "MiMo web search is now opt-in (off by default)",
      zh: "MiMo 联网搜索改为可选(默认关闭)",
    },
    summary: {
      en: "Fixes the 'webSearchEnabled is false' error loop on MiMo accounts without the (separately-billed) Web Search Plugin — web_search is no longer forwarded unless you turn it on.",
      zh: "修复没开通(单独计费的)联网插件的 MiMo 账户上 'webSearchEnabled is false' 报错死循环——除非你主动打开,否则不再转发 web_search。",
    },
    highlights: [
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
