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
import { ApiOutlined, DesktopOutlined, BugOutlined } from "@ant-design/icons";

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
    version: "0.5.6",
    date: "2026-05-28",
    title: {
      en: "Long-conversation 400 hotfix — truncated tool calls auto-sanitized",
      zh: "长对话 400 修复 —— 截断 tool call 自动清洗",
    },
    summary: {
      en: "If your session has been dying mid-conversation with a cryptic \"unexpected end of data: line 1 column 46 (char 45)\" 400 — that's fixed. Sessions poisoned by older proxy versions are healed automatically on the next request; no manual action needed.",
      zh: "如果你的对话用着用着就持续报 \"unexpected end of data: line 1 column 46 (char 45)\" —— 本版本修了。被旧版代理污染的历史会在下次请求时自动恢复，无需任何操作。",
    },
    highlights: [
      {
        kind: "fixed",
        icon: <BugOutlined />,
        title: {
          en: "Truncated tool_call.arguments no longer poison the session",
          zh: "截断的 tool_call.arguments 不再污染会话",
        },
        description: {
          en: "When an upstream stream ended mid tool-call (output token limit, network cut, cancel, thinking budget …), the truncated `arguments` JSON was getting persisted into Codex's session history. Every subsequent request then carried it and strict upstreams (MiMo / DeepSeek / SenseNova) rejected the whole conversation with a JSON parse 400 — the only fix used to be starting a new session. mimo2codex now sanitizes tool-call arguments at three layers (inbound stream, inbound non-stream, and outbound to the upstream) and rewrites unparseable ones to `\"{}\"`, with a clear log warning that names the cause. Existing poisoned sessions revive on their next request; new sessions are immune.",
          zh: "上游 SSE 流在某次工具调用中途结束（输出 token 用尽、网络断、取消、思考预算用光……）时，那条被截断的 `arguments` JSON 会被 Codex 当成完整内容写进会话历史。从此该会话每次新请求都把它原样回放给严格上游（MiMo / DeepSeek / SenseNova），上游解析失败 400，会话直到新建为止都在持续报错。本版本在三个位置（流式入站、非流式入站、出站到上游）统一校验 tool_call.arguments，解析不动的一律改写为 `\"{}\"`，并打一条带因果的 WARN 日志。被污染的存量会话下次请求时自动恢复，新会话从此免疫。",
        },
        location: {
          en: "Automatic — no configuration needed",
          zh: "自动生效，无需任何配置",
        },
      },
      {
        kind: "improved",
        icon: <ApiOutlined />,
        title: {
          en: "Friendlier error if you do hit a malformed-field 400",
          zh: "万一真撞上畸形字段 400，提示更友好",
        },
        description: {
          en: "For the rare case a malformed-field 400 still slips through (older proxy version, unrelated upstream quirk), the raw \"unexpected end of data\" upstream error is rewritten into a bilingual recovery hint instead of being dumped at the user.",
          zh: "万一这种 400 仍然出现（比如还在用更老的 mimo2codex，或上游另有怪癖），原始 \"unexpected end of data\" 上游错误会被改写成双语恢复提示，不再把那段晦涩报文直接丢给用户。",
        },
      },
    ],
  },
  {
    version: "0.5.4",
    date: "2026-05-27",
    title: {
      en: "Windows / macOS desktop app GA + Codex Desktop fixes",
      zh: "Windows / macOS 桌面端正式发布 + Codex Desktop 修复",
    },
    summary: {
      en: "Desktop app graduates from beta to GA. Plus three Codex Desktop tool-handling fixes.",
      zh: "桌面端从 beta 转正式发布。另外三个 Codex Desktop 工具修复。",
    },
    highlights: [
      {
        kind: "new",
        icon: <DesktopOutlined />,
        title: {
          en: "Windows tray / macOS menu-bar desktop app — now GA",
          zh: "Windows 系统托盘 / macOS 顶栏桌面端 —— 正式发布",
        },
        description: {
          en: "Beta tested since v0.4.8 — now stable. Runs mimo2codex in the background, tray / menu-bar icon manages the sidecar, one click opens the admin UI, auto-update wired up. The CLI install (`npm install -g mimo2codex`) is unchanged and can coexist.",
          zh: "v0.4.8 起的 beta 验证完成，现在转正式发布。后台跑 mimo2codex，系统托盘 / 顶栏图标管理 sidecar，一键打开 admin UI，自更新就绪。命令行版（`npm install -g mimo2codex`）依然不变，两者可共存。",
        },
        ctaLabel: { en: "Download", zh: "下载" },
        ctaHref: "https://mimodoc.chengj.online/download",
      },
      {
        kind: "fixed",
        icon: <ApiOutlined />,
        title: {
          en: "Connector plugins no longer fail (issue #39)",
          zh: "Connector 插件不再失败（issue #39）",
        },
        description: {
          en: "GitHub / Canva / HeyGen / Dropbox / Gmail / Google Drive connectors require OpenAI's backend MCP runtime, which a third-party proxy can't substitute for. The upstream model now suggests `shell` + a CLI alternative (e.g. `gh` for GitHub) instead of failing with \"unsupported call\".",
          zh: "GitHub / Canva / HeyGen / Dropbox / Gmail / Google Drive 等 connector 依赖 OpenAI 后端的 MCP 运行时，第三方代理替代不了。上游模型现在会建议用 `shell` + 命令行替代（比如 GitHub 用 `gh`），不再报 \"unsupported call\"。",
        },
        ctaLabel: { en: "Details", zh: "详情" },
        ctaHref: "https://github.com/7as0nch/mimo2codex/blob/main/doc/connector-plugins.md",
      },
      {
        kind: "fixed",
        title: {
          en: "`tool_search` builtin supported (issue #41)",
          zh: "`tool_search` 工具支持（issue #41）",
        },
        description: {
          en: "Codex Desktop's deferred-tool-discovery tool was previously dropped as an unknown type. It's now translated to a function tool — works normally.",
          zh: "Codex Desktop 的延迟工具发现工具之前被当未知类型丢弃。现在翻成 function 工具，恢复正常。",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Vision / capability check follows runtime model override",
          zh: "运行时改模型立即生效（识图 / 能力判断）",
        },
        description: {
          en: "If admin runtime override / alias maps client `mimo-v2.5-pro` to upstream `mimo-v2.5` (which supports vision), images were being stripped at the proxy because the check used the client literal. Now the vision / capability check follows the real upstream model — change the routed model and image input works immediately, no restart needed.",
          zh: "之前如果在 admin 把客户端的 `mimo-v2.5-pro` 运行时映射到 `mimo-v2.5`（支持识图），代理这边还是按客户端那个不支持识图的 id 提前剥掉了图片。修复后识图 / 能力判断跟着真实上游模型 id 走 —— 运行时改模型立即生效，不用重启。",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Namespace tools fixed (PR #34, issue #33)",
          zh: "Namespace 工具修复（PR #34，issue #33）",
        },
        description: {
          en: "Codex Desktop's namespace-wrapped tools (e.g. spawn_agent under multi_agent_v1) no longer fail with \"unsupported call\".",
          zh: "Codex Desktop 的 namespace 包装工具（如 multi_agent_v1 下的 spawn_agent）不再报 \"unsupported call\"。",
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
