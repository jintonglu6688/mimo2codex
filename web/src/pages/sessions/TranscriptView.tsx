import { useTranslation } from "react-i18next";
import { Collapse, Space, Tag, Typography } from "antd";
import { CodeOutlined } from "@ant-design/icons";
import type { TranscriptItem } from "../../api/client";

// Codex-style chat rendering of a parsed rollout. Intentionally simple (no
// markdown engine): assistant/user text is shown with preserved whitespace,
// tool calls render their command/patch + output in code blocks.

const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  fontSize: 12,
};

function firstLine(s: string, max = 60): string {
  const line = (s || "").split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

// Tool calls are collapsed by default so the text conversation stands out;
// expand to see the full command/patch + output.
function ToolBlock({ item }: { item: TranscriptItem }) {
  const { t } = useTranslation("sessions");
  const body = item.command ?? item.input ?? "";
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "tool",
          label: (
            <Space size={6} style={{ fontSize: 12, minWidth: 0 }}>
              <CodeOutlined />
              <Typography.Text strong style={{ fontSize: 12 }}>
                {item.name}
              </Typography.Text>
              {item.status && <Tag style={{ marginInlineEnd: 0 }}>{item.status}</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                {firstLine(body)}
              </Typography.Text>
            </Space>
          ),
          children: (
            <>
              {body && (
                <pre style={{ ...preStyle, marginBottom: 8 }}>
                  <code>{body}</code>
                </pre>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t("toolOutput")}:
              </Typography.Text>
              <pre style={{ ...preStyle, maxHeight: 220, overflow: "auto", marginTop: 2 }}>
                <code>{item.output || t("noOutput")}</code>
              </pre>
            </>
          ),
        },
      ]}
    />
  );
}

function MessageBlock({ item }: { item: TranscriptItem }) {
  const { t } = useTranslation("sessions");
  const isUser = item.role === "user";
  return (
    <div
      style={{
        borderInlineStart: `3px solid ${isUser ? "var(--ant-color-primary, #1677ff)" : "var(--ant-color-success, #52c41a)"}`,
        paddingInlineStart: 10,
      }}
    >
      <Typography.Text strong style={{ fontSize: 12, color: isUser ? undefined : "var(--ant-color-success, #52c41a)" }}>
        {isUser ? t("you") : t("assistant")}
      </Typography.Text>
      <pre style={{ ...preStyle, marginTop: 4, fontFamily: "inherit" }}>{item.text}</pre>
    </div>
  );
}

export function TranscriptView({ items }: { items: TranscriptItem[] }) {
  const { t } = useTranslation("sessions");
  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      {items.map((item, i) => {
        if (item.kind === "message" && item.context) {
          return (
            <Collapse
              key={i}
              size="small"
              items={[
                {
                  key: "ctx",
                  label: (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t("ctx")}
                    </Typography.Text>
                  ),
                  children: <pre style={preStyle}>{item.text}</pre>,
                },
              ]}
            />
          );
        }
        if (item.kind === "message") return <MessageBlock key={i} item={item} />;
        if (item.kind === "reasoning") {
          return (
            <Typography.Paragraph
              key={i}
              type="secondary"
              italic
              style={{ marginBottom: 0, fontSize: 12 }}
            >
              💭 {item.text}
            </Typography.Paragraph>
          );
        }
        return <ToolBlock key={i} item={item} />;
      })}
    </Space>
  );
}

// Build a Markdown export of the transcript.
export function buildTranscriptMarkdown(
  title: string,
  meta: { model: string | null; cwd: string | null },
  items: TranscriptItem[],
  labels: { you: string; assistant: string; ctx: string; reasoning: string; output: string }
): string {
  const out: string[] = [];
  out.push(`# ${title || "Codex session"}`);
  const metaBits = [meta.model ? `model: ${meta.model}` : "", meta.cwd ? `cwd: ${meta.cwd}` : ""].filter(Boolean);
  if (metaBits.length) out.push(`> ${metaBits.join(" · ")}`);
  out.push("");
  for (const item of items) {
    if (item.kind === "message") {
      const who = item.role === "user" ? (item.context ? `${labels.you} (${labels.ctx})` : labels.you) : labels.assistant;
      out.push(`## ${who}`, "", (item.text ?? "").trim(), "");
    } else if (item.kind === "reasoning") {
      out.push(`> 💭 ${labels.reasoning}: ${(item.text ?? "").replace(/\n/g, " ")}`, "");
    } else {
      const body = item.command ?? item.input ?? "";
      out.push(`**🛠 ${item.name}${item.status ? ` (${item.status})` : ""}**`, "");
      if (body) out.push("```sh", body, "```", "");
      out.push(`${labels.output}:`, "", "```", item.output || "", "```", "");
    }
  }
  return out.join("\n");
}
