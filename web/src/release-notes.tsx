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
    version: "0.5.26",
    date: "2026-06-09",
    title: {
      en: "New model: MiMo-V2.5-Pro-UltraSpeed",
      zh: "新模型:MiMo-V2.5-Pro-UltraSpeed",
    },
    summary: {
      en: "Built-in support for Xiaomi's 1T-param UltraSpeed flagship (500-1000 tok/s).",
      zh: "内置支持小米万亿参数 UltraSpeed 旗舰(500-1000 tok/s)。",
    },
    highlights: [
      {
        kind: "new",
        title: {
          en: "New model: MiMo-V2.5-Pro-UltraSpeed",
          zh: "新模型:MiMo-V2.5-Pro-UltraSpeed",
        },
        description: {
          en: "Xiaomi's 1T-param flagship (500-1000 tok/s) is now built in. Sending it used to be silently rewritten to mimo-v2.5-pro (so you ran Pro, not UltraSpeed); now it routes verbatim and shows up in the model catalog and Codex Enable page. Note: it's application-only (apply on the MiMo platform) and runs on the API / pay-as-you-go (sk-) key only — subscription / token-plan accounts can't use it.",
          zh: "小米的万亿参数(1T)旗舰、500-1000 tok/s 极速模型现已内置。此前发送它会被静默改写成 mimo-v2.5-pro(实际跑的是 Pro 而非 UltraSpeed);现在原样路由,并出现在模型目录和「Codex 启用」页。注意:需在 MiMo 平台申请开通,且仅支持 API / 按量付费(sk-)key,套餐订阅账户用不了。",
        },
        location: {
          en: "Codex Enable page → pick MiMo V2.5 Pro UltraSpeed",
          zh: "「Codex 启用」页 → 选 MiMo V2.5 Pro UltraSpeed",
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
